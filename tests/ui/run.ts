import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { restoreSeed } from '../../db/seed.ts';
import { startDevServer } from '../../scripts/dev-server.ts';
import { startProxy } from './proxy.ts';

// 乱数の探索(フェーズの区切りに流す)。毎回の合否には使わない。性質が破れたら失敗にし、
// 届かなかった場面(空振り)は報告だけする。探索は再現できない(地図の描画や通信の時刻で、画面の状態が
// 毎回違う)。見つけた現象は、記録(トレース・スクリーンショット・プロキシの記録)から読み、
// 決まった入力のテスト(E2E など)にしてから直す(CLAUDE.md)。
const timeLimit = process.argv[2] ?? '3m';
const upstream = new URL('http://localhost:5198');
const origin = new URL('http://localhost:5197');
const minObserved = 3;

const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
await admin.connect();
await restoreSeed(admin);

const proxy = startProxy(Number(origin.port), upstream, async (id) => {
	await admin.query(
		`with u as (update feature set version = version + 1, note = note || '(ほかの人)'
		            where id = $1 returning id, version)
		 insert into feature_update (request_key, feature_id, version)
		 select gen_random_uuid(), id, version from u`,
		[id]
	);
});
// 記録は evidence/(git には入れない)に残す。見つけた現象を読んで、決まった入力のテストにするため
const out = join(
	'evidence',
	'explore',
	new Date().toLocaleString('sv-SE').replace(' ', 'T').replaceAll(':', '-')
);
await mkdir(out, { recursive: true });
let stopServer = () => {};

try {
	stopServer = await startDevServer(origin.origin, { port: upstream.port, quiet: true });

	const bombadil = spawn(
		'node_modules/.bin/bombadil',
		[
			'browser',
			'test',
			'--headless',
			'--width=1280',
			'--height=800',
			`--time-limit=${timeLimit}`,
			`--output-path=${out}`,
			origin.href,
			'tests/ui/app.spec.ts'
		],
		{ stdio: 'inherit' }
	);
	const exitCode = await new Promise<number>((r) => bombadil.on('exit', (code) => r(code ?? 1)));
	// プロキシの記録(どの要求にどの障害を起こしたか、検索をいつ送りいつ返したか)。トレースと時刻で突き合わせて読む
	await writeFile(
		join(out, 'proxy.json'),
		JSON.stringify({ requests: proxy.log, searches: proxy.searches }, null, 1)
	);
	const trace = join(out, 'trace.jsonl');
	if (
		!(await access(trace).then(
			() => true,
			() => false
		))
	)
		throw new Error(`Bombadil が記録を残さずに終わった(終了コード ${exitCode})`);

	const observed = new Map<string, number>();
	const violated = new Map<string, number>();
	for (const line of (await readFile(trace, 'utf8')).trim().split('\n')) {
		const entry = JSON.parse(line);
		const snapshot = (name: string) =>
			entry.snapshots.find((s: { name: string | null }) => s.name === name)?.value;
		const kind = [snapshot('panel')?.app, snapshot('panel')?.screen].filter(Boolean).join('/');
		observed.set(kind, (observed.get(kind) ?? 0) + 1);
		if (snapshot('panel')?.identityChanged)
			observed.set('本人違いで止めた', (observed.get('本人違いで止めた') ?? 0) + 1);
		if (snapshot('panel')?.stale)
			observed.set('編集中(ほかの人の更新)', (observed.get('編集中(ほかの人の更新)') ?? 0) + 1);
		if (snapshot('panel')?.applied)
			observed.set('更新中(効いたと分かった)', (observed.get('更新中(効いたと分かった)') ?? 0) + 1);
		const list = snapshot('listing')?.state;
		if (list) observed.set(`一覧/${list}`, (observed.get(`一覧/${list}`) ?? 0) + 1);
		if (snapshot('popup')) {
			const popup = `ポップアップ/${snapshot('panel')?.role}`;
			observed.set(popup, (observed.get(popup) ?? 0) + 1);
		}
		for (const v of entry.violations ?? []) violated.set(v.name, (violated.get(v.name) ?? 0) + 1);
	}

	const { rows } = await admin.query(
		`select count(*)::int as keyed,
			(select count(*)::int from (
				select 1 from feature where request_key is not null
				group by st_asbinary(geom) having count(*) > 1
			) d) as duplicated,
			(select count(*)::int from feature_update) as updates,
			(select count(*)::int from feature f
			 where f.version <> (select count(*) from feature_update u where u.feature_id = f.id)) as untracked
		 from feature where request_key is not null`
	);

	console.log('\n観測した画面(状態の数)', Object.fromEntries(observed));
	console.log('プロキシが起こした障害(保存の要求の数)', Object.fromEntries(proxy.counts));
	console.log('保存された地物', rows[0].keyed, '/ 同じ形で二重にできた地物', rows[0].duplicated);
	console.log(
		'効いた更新',
		rows[0].updates,
		'/ 版とキーの数が合わない地物(更新が二重に効いたか、キーなしで効いた)',
		rows[0].untracked
	);
	console.log('破れた性質', Object.fromEntries(violated));
	const retried = proxy.log.filter(
		(a, i) =>
			a.fault === '保存したが接続が切れる' &&
			proxy.log.slice(i + 1).some((b) => b.key === a.key && b.at - a.at < 1000)
	);
	console.log(
		'接続が切れたあと、同じキーで1秒以内に再び届いた保存(ブラウザの自動再送)',
		retried.length,
		'/',
		proxy.counts.get('保存したが接続が切れる')
	);
	console.log(
		'再利用した接続で届いた保存',
		proxy.log.filter((a) => a.reused).length,
		'/',
		proxy.log.length
	);

	// 検索の応答の追い越し: 先に送った検索の応答が、あとから送った検索の応答より遅れて届いた数。
	// 本人をまたぐ追い越し: ある本人の検索の応答が、別の本人として送った検索よりあとに届いた数
	const answered = proxy.searches.filter((s) => s.done > 0);
	const overtaken = answered.filter((a) =>
		answered.some((b) => b.sent > a.sent && b.done < a.done)
	).length;
	const crossed = answered.filter((a) =>
		answered.some((b) => b.as !== a.as && b.sent > a.sent && b.sent < a.done)
	).length;
	console.log(
		'検索',
		proxy.searches.length,
		'/ 追い越された検索の応答',
		overtaken,
		'/ 別の本人の検索のあとに届いた応答',
		crossed
	);
	observed.set('追い越された検索の応答', overtaken);
	observed.set('別の本人の検索のあとに届いた応答', crossed);

	const unreached = [
		'ログイン済み/保存中',
		'ログイン済み/再送中',
		'ログイン済み/結果不明',
		'ログイン済み/編集中',
		'ログイン済み/更新中',
		'ログイン済み/更新結果不明',
		'ログイン済み/競合',
		...['admin', 'a-staff', 'b-staff', 'viewer'].map((role) => `ポップアップ/${role}`),
		'編集中(ほかの人の更新)',
		'更新中(効いたと分かった)',
		'一覧/検索中',
		'一覧/見つかった',
		'追い越された検索の応答',
		'別の本人の検索のあとに届いた応答'
	].filter((k) => (observed.get(k) ?? 0) < minObserved);
	if (unreached.length)
		console.log(
			`${minObserved} 回未満しか観測できなかった場面(この探索では、ここに関わる性質をほとんど確かめていない)`,
			unreached
		);
	if (rows[0].duplicated) console.log('P10 が破れた: 同じ形の地物が二重にできた');
	if (rows[0].untracked) console.log('P12 が破れた: 版とキーの数が合わない地物がある');
	console.log(`\n記録: ${out}(トレース・スクリーンショット・プロキシの記録)`);
	process.exitCode = exitCode || rows[0].duplicated || rows[0].untracked ? 1 : 0;
} finally {
	stopServer();
	proxy.close();
	await restoreSeed(admin);
	await admin.end();
}
