import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { restoreSeed } from '../../db/seed.ts';
import { startDevServer } from '../../scripts/dev-server.ts';
import { startProxy } from './proxy.ts';

// 乱数の探索(フェーズの区切りに流す)。毎回の合否には使わない。性質が破れたら失敗にし、
// 届かなかった場面(空振り)は報告だけする。種と Bombadil のトレースがあれば、同じ探索をもう一度流せる。
const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { seed: { type: 'string' }, reproduce: { type: 'string' } }
});
const timeLimit = positionals[0] ?? '3m';
const seed = Number(values.seed ?? Math.floor(Math.random() * 2 ** 31));
if (!Number.isInteger(seed)) throw new Error(`--seed は整数: ${values.seed}`);
const upstream = new URL('http://localhost:5198');
const origin = new URL('http://localhost:5197');
const minObserved = 3;

const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
await admin.connect();
await restoreSeed(admin);

const proxy = startProxy(Number(origin.port), upstream, seed, async (id) => {
	await admin.query(
		`with u as (update feature set version = version + 1, note = note || '(ほかの人)'
		            where id = $1 returning id, version)
		 insert into feature_update (request_key, feature_id, version)
		 select gen_random_uuid(), id, version from u`,
		[id]
	);
});
const out = await mkdtemp(join(tmpdir(), 'bombadil-'));
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
			values.reproduce ? `--reproduce=${values.reproduce}` : `--time-limit=${timeLimit}`,
			`--output-path=${out}`,
			origin.href,
			'tests/ui/app.spec.ts'
		],
		{ stdio: 'inherit' }
	);
	const exitCode = await new Promise<number>((r) => bombadil.on('exit', (code) => r(code ?? 1)));

	const observed = new Map<string, number>();
	const violated = new Map<string, number>();
	for (const line of (await readFile(join(out, 'trace.jsonl'), 'utf8')).trim().split('\n')) {
		const entry = JSON.parse(line);
		const snapshot = (name: string) =>
			entry.snapshots.find((s: { name: string | null }) => s.name === name)?.value;
		const kind = [snapshot('panel')?.app, snapshot('panel')?.screen].filter(Boolean).join('/');
		observed.set(kind, (observed.get(kind) ?? 0) + 1);
		if (snapshot('panel')?.identityChanged)
			observed.set('本人違いで止めた', (observed.get('本人違いで止めた') ?? 0) + 1);
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
	console.log('トレース', out);
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
	console.log(
		`\n種 ${seed}。同じ探索をもう一度流す: pnpm test:ui --seed ${seed} --reproduce ${join(out, 'trace.jsonl')}`
	);
	process.exitCode = exitCode || rows[0].duplicated || rows[0].untracked ? 1 : 0;
} finally {
	stopServer();
	proxy.close();
	await restoreSeed(admin);
	await admin.end();
}
