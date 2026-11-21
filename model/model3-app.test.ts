import { expect, test } from 'vitest';
import { offers, receive, saving } from '#lib/app/machine.ts';
import { check } from './check.ts';
import * as m3 from './model3-app.ts';

const properties = {
	'応答を捨てない: 飛んでいる副作用への応答は、届いた状態で必ず受け取れる': m3.repliesAccepted,
	'L1 保存中なら、その保存の結果はまだ届いていない(届けば保存中を抜ける)': m3.l1,
	'P6 保存中は描画開始を差し出さない': m3.p6,
	'P10 結果が分からなくなった保存は、同じキー・同じ中身でしか送り直さない': m3.p10,
	飛んでいる保存は高々1つ: m3.singleFlight,
	'保存できたと表示したら、表示していた図形がそのままサーバーにある': m3.honestSuccess,
	'編集できない人は描けない。市職員は自分の市にしか描けない': m3.drawPermission
};

for (const [name, property] of Object.entries(properties))
	test(`モデル3 実装の offers・receive: ${name}`, () => {
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

const logoutWhileSaving: m3.Machine = {
	receive,
	offers: (s) =>
		s.kind === 'ログイン済み' && saving(s.screen)
			? {
					...offers(s),
					ログアウトを押す: () => ({
						state: { kind: 'ログアウト中', from: s },
						effects: [{ type: 'ログアウトする' }]
					})
				}
			: offers(s)
};

const logoutWhileSavingTrace = [
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
];

test('モデル3 対照: 保存中もログアウトできると、ログアウト中に届いた保存の結果が捨てられる(応答を捨てない・L1 が同じ手順で破れる)', () => {
	expect(check(m3.init, m3.stepsWith(logoutWhileSaving), m3.repliesAccepted)).toMatchObject({
		ok: false,
		trace: logoutWhileSavingTrace
	});
	expect(check(m3.init, m3.stepsWith(logoutWhileSaving), m3.l1)).toMatchObject({
		ok: false,
		trace: logoutWhileSavingTrace
	});
});

const editWhileUnknown: m3.Machine = {
	receive,
	offers: (s) => {
		if (s.kind !== 'ログイン済み' || s.screen.kind !== '結果不明') return offers(s);
		const v = s.screen;
		return {
			...offers(s),
			地図をクリック: (e) => ({
				state: { ...s, screen: { ...v, draft: { ...v.draft, points: [...v.draft.points, e.at] } } },
				effects: []
			})
		};
	}
};

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

const dropSavedWhileResaving: m3.Machine = {
	offers,
	receive: (s, r) =>
		s.kind === 'ログイン済み' && s.screen.kind === '再送中' && r.type === '保存成功'
			? undefined
			: receive(s, r)
};

test('モデル3 対照: 再送中に届いた保存成功を受け取れないと、応答を捨てないが破れる', () => {
	const result = check(m3.init, m3.stepsWith(dropSavedWhileResaving), m3.repliesAccepted);
	expect(result).toMatchObject({ ok: false });
	expect(result.ok || result.trace.slice(-2)).toEqual(['再送', 'k1をサーバーが保存し、成功が届く']);
});
