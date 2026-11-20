import { expect, test } from 'vitest';
import { next, saving } from '#lib/app/machine.ts';
import { check } from './check.ts';
import * as m3 from './model3-app.ts';

const properties = {
	'L1 保存中なら、その保存の結果はまだ届いていない(届けば保存中を抜ける)': m3.l1,
	'P6 保存中は新しい描画が始まらない': m3.p6,
	'P10 結果が分からなくなった保存は、同じキー・同じ中身でしか送り直さない': m3.p10,
	飛んでいる保存は高々1つ: m3.singleFlight,
	'保存できたと表示したら、表示していた図形がそのままサーバーにある': m3.honestSuccess,
	'編集できない人は描けない。市職員は自分の市にしか描けない': m3.drawPermission
};

for (const [name, property] of Object.entries(properties))
	test(`モデル3 実装の next: ${name}`, () => {
		expect(check(m3.init, m3.steps, property)).toMatchObject({ ok: true });
	});

test('モデル3 対照: 探索が全部の画面に届いている(性質が空振りしていないことの確認)', () => {
	const kinds = new Set<string>();
	check(m3.init, m3.steps, (w) => kinds.add(m3.kindOf(w.app)) && true);
	expect([...kinds].sort()).toEqual(
		[
			'未ログイン',
			'ログイン中',
			...['閲覧', '描画中', '保存中', '再送中', '結果不明'].map((v) => `ログイン済み/${v}`),
			...['閲覧', '描画中', '結果不明'].map((v) => `ログアウト中/${v}`)
		].sort()
	);
});

const logoutWhileSaving: m3.Machine = (s, e) =>
	s.kind === 'ログイン済み' && saving(s.screen) && e.type === 'ログアウトを押す'
		? { state: { kind: 'ログアウト中', from: s }, effects: [{ type: 'ログアウトする' }] }
		: next(s, e);

test('モデル3 対照: 保存中もログアウトできると、ログアウト中に届いた保存の結果が捨てられ、L1 が破れる', () => {
	expect(check(m3.init, m3.stepsWith(logoutWhileSaving), m3.l1)).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'管理者でログインを押す',
			'管理者のログインが通る',
			'描画開始(k1)',
			'地図のp1をクリック',
			'地図のp1をクリック',
			'地図のp1をクリック',
			'確定',
			'ログアウトを押す',
			'k1をサーバーが保存し、成功が届く'
		]
	});
});

const editWhileUnknown: m3.Machine = (s, e) =>
	s.kind === 'ログイン済み' && s.screen.kind === '結果不明' && e.type === '地図をクリック'
		? {
				state: {
					...s,
					screen: {
						...s.screen,
						draft: { ...s.screen.draft, points: [...s.screen.draft.points, e.at] }
					}
				},
				effects: []
			}
		: next(s, e);

test('モデル3 対照: 結果不明のあとに図形を直せると、同じキーで違う中身を送り、P10 が破れる', () => {
	expect(check(m3.init, m3.stepsWith(editWhileUnknown), m3.p10)).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'管理者でログインを押す',
			'管理者のログインが通る',
			'描画開始(k1)',
			'地図のp1をクリック',
			'地図のp1をクリック',
			'地図のp1をクリック',
			'確定',
			'k1をサーバーが保存したが、応答が届かない',
			'地図のp1をクリック',
			'再送'
		]
	});
	expect(check(m3.init, m3.stepsWith(editWhileUnknown), m3.honestSuccess)).toMatchObject({
		ok: false
	});
});
