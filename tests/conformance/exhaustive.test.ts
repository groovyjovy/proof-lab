import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Me } from '#lib/domain.ts';
import type { Area, State } from '#lib/app/machine.ts';
import { check } from '../../model/check.ts';
import * as m3 from '../../model/model3-app.ts';
import { startOracle, type Oracle } from '../../scripts/spec-oracle.ts';
import { applyEvent, normalize, snapshot, type Event } from './implementation.ts';

let oracle: Oracle;
beforeAll(() => {
	oracle = startOracle();
});
afterAll(() => oracle.close());

const users: Me[] = [
	{ id: 'u-admin', name: '管理者', role: 'admin', canEdit: true },
	{ id: 'u-a', name: 'A市職員', role: 'a-staff', canEdit: true },
	{ id: 'u-viewer', name: '閲覧者', role: 'viewer', canEdit: false }
];

const areas: Area[] = [
	[
		[0, 0],
		[1, 1]
	],
	[
		[5, 5],
		[6, 6]
	]
];
const hit = { ref: { id: 2, city: 'A' as const, public: false }, properties: { name: 'f2' } };

// どの状態にも、すべての種類の操作・応答・知らせを1つずつ当てる(差し出していない操作も当てて、両方とも「なし」になるかを見る)
const branches: Event[] = [
	...users.map((u): Event => ({ op: { type: 'ログインを押す', email: `${u.role}@example.com` } })),
	{ op: { type: 'ログアウトを押す' } },
	{ op: { type: '地図をクリック', at: [0, 0], feature: null } },
	...[
		{ id: 1, city: 'A' as const, public: true },
		{ id: 2, city: 'B' as const, public: false }
	].map((ref): Event => ({
		op: { type: '地図をクリック', at: [0, 0], feature: { ref, properties: { name: 'p' } } }
	})),
	{ op: { type: 'ポップアップを閉じる' } },
	{ op: { type: '描画開始', key: 'k-new' } },
	{ op: { type: '市を選ぶ', city: 'A' } },
	{ op: { type: '市を選ぶ', city: 'B' } },
	{ op: { type: '公開を選ぶ', public: true } },
	{ op: { type: '公開を選ぶ', public: false } },
	{ op: { type: '確定' } },
	{ op: { type: '取消' } },
	{ op: { type: '再送' } },
	{ op: { type: '編集を始める' } },
	{ op: { type: '名前を変える', name: 'n2' } },
	{ op: { type: '備考を変える', note: '備考' } },
	{ op: { type: '編集を保存', key: 'u-new' } },
	{ op: { type: '読み直す' } },
	...users.map((me): Event => ({ reply: { type: 'ログイン成功', me } })),
	{ reply: { type: 'ログイン失敗', message: '失敗' } },
	{ reply: { type: 'ログアウト完了' } },
	{ reply: { type: 'ログアウト失敗' } },
	{ reply: { type: '保存成功' } },
	{ reply: { type: '保存失敗' } },
	{ reply: { type: '保存結果不明' } },
	{ reply: { type: '本人が変わった' } },
	{
		reply: {
			type: '読み込めた',
			edit: { ref: { id: 1, city: 'A', public: true }, version: 5, name: '読んだ名前', note: '' }
		}
	},
	{ reply: { type: '読み込めない' } },
	{ reply: { type: '競合した' } },
	{ notice: { type: '地図の本人が変わった' } },
	...areas.map((area): Event => ({ notice: { type: '地図が動いた', area } })),
	...[
		{ id: 1, version: 1, key: 'u1', as: 'u-admin' },
		{ id: 1, version: 3, key: 'other', as: 'u-admin' },
		{ id: 1, version: 3, key: 'other', as: 'u-a' },
		{ id: 2, version: 1, key: 'x', as: 'u-admin' },
		{ id: 1, version: 1, key: 'u2', as: 'u-a' }
	].map((change): Event => ({ notice: { type: '地物が変わった', change } })),
	...['u-admin', 'u-a'].map((as): Event => ({ notice: { type: '変更の流れをつなぎ直した', as } })),
	...[0, 1, 2, 3, 4].flatMap((seq): Event[] => [
		{ reply: { type: '検索の応答', seq, result: { type: '見つかった', hits: [hit] } } },
		{ reply: { type: '検索の応答', seq, result: { type: '検索できない' } } },
		{ reply: { type: '検索の応答', seq, result: { type: '本人が変わった' } } }
	])
];

test('範囲内の網羅: モデル3(作成・編集・検索)がたどる画面のすべての状態で、すべてのイベントについて、実装の状態機械と Lean の仕様が同じ結果を返す', async () => {
	const states = new Map<string, State>();
	for (const steps of [m3.steps, m3.editSteps, m3.searchSteps])
		check(m3.init, steps, (w) => {
			states.set(JSON.stringify(w.app), w.app);
			return true;
		});
	const answers = await Promise.all(
		[...states.values()].map((state) => oracle.ask({ state, branches }))
	);
	[...states.values()].forEach((state, i) => {
		const actual = normalize({
			snapshot: snapshot(state, []),
			branches: branches.map((e) => {
				const step = applyEvent(state, e);
				return step ? snapshot(step.state, step.effects) : null;
			})
		});
		expect(actual, JSON.stringify(state)).toEqual(normalize(answers[i]));
	});
	// 作成・編集の範囲と検索の範囲で重なる状態(ログイン前後の閲覧など)は1つに数える
	expect(states.size).toBe(2075);
	// docs/proofs.md に書いた数が、今の数と同じか(状態機械を変えて書き直し忘れると落ちる)
	const n = (x: number) => x.toLocaleString('en-US');
	expect(readFileSync('docs/proofs.md', 'utf8')).toContain(
		`重複なしで ${n(states.size)})のすべてに、すべての種類の操作・応答・知らせ(${branches.length}種類)を1つずつ当て、${n(states.size * branches.length)} 通り`
	);
}, 120_000);
