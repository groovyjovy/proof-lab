import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { restoreSeed } from '../../db/seed.ts';
import { startDevServer } from '../../scripts/dev-server.ts';
import { startProxy } from './proxy.ts';

const timeLimit = process.argv[2] ?? '3m';
const upstream = new URL('http://localhost:5198');
const origin = new URL('http://localhost:5197');
const minObserved = 3;

const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
await admin.connect();
await restoreSeed(admin);

const proxy = startProxy(Number(origin.port), upstream);
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
			`--time-limit=${timeLimit}`,
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
			) d) as duplicated
		 from feature where request_key is not null`
	);

	console.log('\n観測した画面(状態の数)', Object.fromEntries(observed));
	console.log('プロキシが起こした障害(保存の要求の数)', Object.fromEntries(proxy.counts));
	console.log('保存された地物', rows[0].keyed, '/ 同じ形で二重にできた地物', rows[0].duplicated);
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

	const unobserved = [
		'ログイン済み/保存中',
		'ログイン済み/再送中',
		'ログイン済み/結果不明',
		...['admin', 'a-staff', 'b-staff', 'viewer'].map((role) => `ポップアップ/${role}`)
	].filter((k) => (observed.get(k) ?? 0) < minObserved);
	if (unobserved.length) console.log(`${minObserved} 回未満しか観測できなかった画面`, unobserved);
	if (rows[0].duplicated) console.log('P10 が破れた: 同じ形の地物が二重にできた');
	process.exitCode = exitCode || unobserved.length || rows[0].duplicated ? 1 : 0;
} finally {
	stopServer();
	proxy.close();
	await restoreSeed(admin);
	await admin.end();
}
