import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check } from './check.ts';
import * as m1 from './model1-concurrent-edit.ts';
import * as m2 from './model2-revocation.ts';

const jar = new URL('../tools/tla2tools.jar', import.meta.url).pathname;
const tlaDir = new URL('../tla/', import.meta.url).pathname;
const noJar = !existsSync(jar);
const tlcTimeout = 30_000;

function tlc(spec: string, cfg: string, ...flags: string[]) {
	const metadir = mkdtempSync(join(tmpdir(), 'tlc-'));
	const { stdout } = spawnSync(
		'java',
		[
			'-XX:+UseParallelGC',
			'-cp',
			jar,
			'tlc2.TLC',
			'-workers',
			'1',
			'-metadir',
			metadir,
			...flags,
			'-config',
			cfg,
			spec
		],
		{ cwd: tlaDir, encoding: 'utf8' }
	);
	rmSync(metadir, { recursive: true, force: true });
	expect(stdout).not.toMatch(/Parsing or semantic analysis failed|Error: TLC threw/);
	return {
		stdout,
		distinct: Number([...stdout.matchAll(/(\d+) distinct states found/g)].at(-1)?.[1]),
		violatedInvariant: stdout.match(/Error: Invariant (\w+) is violated/)?.[1],
		violatedTemporal: /Temporal properties were violated/.test(stdout),
		trace: [...stdout.matchAll(/^State \d+: (?:<(\w+)|(Stuttering))/gm)].map((x) => x[1] ?? x[2])
	};
}

test('モデル1 素朴な保存: P4 の反例が付録Aと同じ手順・状態数で出る', () => {
	expect(check(m1.init, m1.steps(false), m1.p4)).toEqual({
		ok: false,
		states: 23,
		trace: [
			'初期状態',
			'Aが読み込む',
			'Aが編集する',
			'Bが読み込む',
			'Aが保存する',
			'Bが編集する',
			'Bが保存する'
		]
	});
});

test('モデル1 バージョン付き: P4 が全21状態で成り立つ', () => {
	expect(check(m1.init, m1.steps(true), m1.p4)).toEqual({ ok: true, states: 21 });
});

test('モデル2 cacheで認可: 剥奪後に送った保存がCookieのroleで受理される(P3の反例)', () => {
	expect(check(m2.init, m2.steps('cache'), m2.p3)).toEqual({
		ok: false,
		states: 19,
		trace: [
			'初期状態',
			'a-staffが読み込む',
			'a-staffが編集する',
			'管理者が剥奪する',
			'a-staffが保存を送る(Cookieのrole=editor)',
			'サーバーがcacheのrole=editorで保存を受理する'
		]
	});
});

test('モデル2 dbで認可: P3 が全18状態で成り立つ', () => {
	expect(check(m2.init, m2.steps('db'), m2.p3)).toEqual({ ok: true, states: 18 });
});

test.skipIf(noJar)(
	'TLA+ Revocation cache: 自作検査器と同じ手順の反例、全状態数も一致',
	() => {
		const r = tlc('Revocation.tla', 'Revocation_cache.cfg');
		expect(r.violatedInvariant).toBe('P3');
		expect(r.trace).toEqual(['Initial', 'Load', 'Edit', 'Revoke', 'Send', 'Accept']);
		const own = check(m2.init, m2.steps('cache'), m2.p3);
		expect(own.ok ? 0 : own.trace.length).toBe(r.trace.length);
		const all = tlc('Revocation.tla', 'Revocation_cache.cfg', '-continue');
		expect(all.distinct).toBe(check(m2.init, m2.steps('cache'), () => true).states);
	},
	tlcTimeout
);

test.skipIf(noJar)(
	'TLA+ Revocation db: P3 が成り立ち、全状態数が自作検査器と一致',
	() => {
		const r = tlc('Revocation.tla', 'Revocation_db.cfg');
		expect(r.violatedInvariant).toBeUndefined();
		expect(r.distinct).toBe(check(m2.init, m2.steps('db'), m2.p3).states);
	},
	tlcTimeout
);

test.skipIf(noJar)(
	'TLA+ DrawUI タイムアウトなし: 応答が失われると保存中から抜けない(L1の反例)',
	() => {
		const r = tlc('DrawUI.tla', 'DrawUI_noTimeout.cfg');
		expect(r.violatedTemporal).toBe(true);
		expect(r.trace.slice(-3)).toEqual(['Commit', 'Lose', 'Stuttering']);
	},
	tlcTimeout
);

test.skipIf(noJar)(
	'TLA+ DrawUI タイムアウトあり: L1 が成り立つ',
	() => {
		const r = tlc('DrawUI.tla', 'DrawUI_timeout.cfg');
		expect(r.violatedTemporal).toBe(false);
		expect(r.distinct).toBe(7);
	},
	tlcTimeout
);
