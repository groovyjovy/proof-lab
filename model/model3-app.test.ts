import { expect, test } from 'vitest';
import { identityChangedMessage, notify, offers, receive, saving } from '#lib/app/machine.ts';
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

const editProperties = {
	'応答を捨てない: 飛んでいる副作用への応答は、届いた状態で必ず受け取れる': m3.repliesAccepted,
	'L1 応答待ち(読込中・更新中)なら、その副作用がまだ飛んでいる': m3.busyAwaits,
	'P12 結果が分からなくなった更新は、同じキー・同じ中身でしか送り直さない': m3.p12,
	'競合の表示が正直: 競合と表示したとき、その更新はサーバーで効いていない': m3.honestConflict,
	'更新の成功の表示が正直: 成功と表示したとき、その更新はサーバーで効いている': m3.honestUpdate
};

for (const [name, property] of Object.entries(editProperties))
	test(`モデル3(編集) 実装の offers・receive: ${name}`, () => {
		expect(check(m3.init, m3.editSteps, property)).toMatchObject({ ok: true });
	});

test('モデル3(編集) 対照: 探索が編集の画面に全部届いている', () => {
	const kinds = new Set<string>();
	check(m3.init, m3.editSteps, (w) => kinds.add(m3.kindOf(w.app)) && true);
	for (const kind of ['読込中', '編集中', '更新中', '更新結果不明', '競合'])
		expect(kinds.has(`ログイン済み/${kind}`), kind).toBe(true);
});

test('モデル3(編集) 対照: サーバーが更新のキーを見ないと、効いた更新を送り直したときに自分の更新と競合する(競合の表示 が破れる)', () => {
	expect(
		check(
			m3.init,
			m3.stepsWith(m3.machine, { ...m3.editing, idempotentUpdates: false }),
			m3.honestConflict
		)
	).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'管理者でログインを押す',
			'管理者のログインが通る',
			'p1の地物をクリック',
			'編集を始める',
			'地物を読み込めた(版0)',
			'編集を保存(u1)',
			'u1が効いたが、応答が届かない',
			'再送',
			'u1は版が古く、競合が届く'
		]
	});
});

const resendWithNewKey: m3.Machine = {
	receive,
	notify,
	offers: (s) => {
		if (s.kind !== 'ログイン済み' || s.screen.kind !== '更新結果不明') return offers(s);
		const v = s.screen;
		return {
			...offers(s),
			再送: () => ({
				state: { ...s, screen: { kind: '更新中', edit: v.edit, key: 'u-new' } },
				effects: [{ type: '更新する', edit: v.edit, key: 'u-new', as: s.me.id }]
			})
		};
	}
};

test('モデル3(編集) 対照: 再送で新しいキーを作ると、P12 が破れる', () => {
	expect(check(m3.init, m3.stepsWith(resendWithNewKey, m3.editing), m3.p12)).toMatchObject({
		ok: false
	});
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
	notify,
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
	notify,
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
	notify,
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

const logoutOnNoticeWhileSaving: m3.Machine = {
	offers,
	receive,
	notify: (s, n) =>
		s.kind === 'ログイン済み'
			? { state: { kind: '未ログイン', error: '本人違い', map: s.map }, effects: [] }
			: notify(s, n)
};

test('モデル3 対照: 保存中にタイルの本人違いが届いて画面を閉じると、保存の応答が捨てられる(応答を捨てない が破れる)', () => {
	const result = check(m3.init, m3.stepsWith(logoutOnNoticeWhileSaving), m3.repliesAccepted);
	expect(result).toMatchObject({ ok: false });
	expect(result.ok || result.trace.slice(-3)).toEqual([
		'確定',
		'地図の本人が変わった',
		'k1をサーバーが保存し、成功が届く'
	]);
});

const searchProperties = {
	'応答を捨てない: 前のセッションの検索の応答も、届いた状態で必ず受け取れる': m3.repliesAccepted,
	'P13 一覧に出している地物は、今の本人が読めるものだけ': m3.p13Readable,
	'P13 一覧の地物は、一覧が示す範囲のもの': m3.p13Matches,
	'P13 検索中でなければ、一覧は今見えている範囲のもの': m3.p13Settled,
	'検索中なら、その検索の応答はまだ届いていない(届けば検索中を抜ける)': m3.searchAwaits,
	'本人が変わっていないのに、本人違いとして画面を止めない': m3.noFalseIdentityChange
};

// 検索の範囲は状態が多い(約47万)ので、1回の探索ですべての性質と、探索が届いたところを見る
test('モデル3(検索) 実装の receive・notify: 応答の順序が入れ替わっても、P13 と応答を捨てないが成り立つ', () => {
	const failed = new Set<string>();
	const seen = new Set<string>();
	const result = check(m3.init, m3.searchSteps, (w) => {
		for (const [name, property] of Object.entries(searchProperties))
			if (!property(w)) failed.add(name);
		const s = m3.session(w.app);
		if (s?.search.pending && s.search.shown) seen.add('一覧を出したまま検索中');
		if (w.answered.length >= 2) seen.add('応答が2つ届く途中');
		if (w.answered.some((r) => r.type === '検索の応答' && r.seq < (s?.search.pending?.seq ?? -1)))
			seen.add('追い越された検索の応答が届く途中');
		if (s && w.inflight.some((f) => f.type === '検索する' && f.as !== s.me.id))
			seen.add('前の本人の検索が飛んでいる');
		if (w.app.kind === '未ログイン' && w.app.error === identityChangedMessage)
			seen.add('本人違いで止めた');
		return failed.size === 0;
	});
	expect({ result, failed: [...failed] }).toMatchObject({ result: { ok: true }, failed: [] });
	expect(result.states).toBeGreaterThan(400_000);
	expect([...seen].sort()).toEqual(
		[
			'一覧を出したまま検索中',
			'応答が2つ届く途中',
			'追い越された検索の応答が届く途中',
			'前の本人の検索が飛んでいる',
			'本人違いで止めた'
		].sort()
	);
}, 60_000);

/** 番号を見ずに、届いた応答をそのまま一覧に出す(よくある素朴な実装)。 */
const showEveryReply: m3.Machine = {
	offers,
	notify,
	receive: (s, r) => {
		if (s.kind !== 'ログイン済み' || r.type !== '検索の応答' || r.result.type !== '見つかった')
			return receive(s, r);
		const query = s.search.pending ?? s.search.shown?.query;
		if (!query) return receive(s, r);
		const shown = { kind: '見つかった' as const, query, hits: r.result.hits };
		return { state: { ...s, search: { pending: null, shown } }, effects: [] };
	}
};

test('モデル3(検索) 対照: 番号を見ずに届いた応答を出すと、追い越された検索の応答が新しい範囲の一覧になる', () => {
	const result = check(m3.init, m3.stepsWith(showEveryReply, m3.searching), m3.p13Matches);
	expect(result).toMatchObject({ ok: false });
	expect(result.ok || result.trace).toEqual([
		'初期状態',
		'管理者でログインを押す',
		'地図をa1に動かす',
		'管理者のログインが通る',
		'地図をa2に動かす',
		'検索0(a1、管理者)にサーバーが答える',
		'検索0の応答(見つかった)が届く'
	]);
});

/** 番号をセッションごとに 0 から振る(番号をセッションの中に持つ素朴な実装)。 */
const numberPerSession: m3.Machine = {
	offers,
	notify,
	receive: (s, r) =>
		receive(
			s.kind === 'ログイン中' && r.type === 'ログイン成功'
				? { ...s, map: { ...s.map, issued: 0 } }
				: s,
			r
		)
};

test('モデル3(検索) 対照: 番号をセッションごとに振り直すと、前の本人(管理者)への応答が閲覧者の一覧に出る', () => {
	const result = check(m3.init, m3.stepsWith(numberPerSession, m3.searching), m3.p13Readable);
	expect(result).toMatchObject({ ok: false });
	expect(result.ok || result.trace).toEqual([
		'初期状態',
		'管理者でログインを押す',
		'地図をa1に動かす',
		'管理者のログインが通る',
		'ログアウトを押す',
		'検索0(a1、管理者)にサーバーが答える',
		'ログアウトが通る',
		'閲覧者でログインを押す',
		'閲覧者のログインが通る',
		'検索0の応答(見つかった)が届く'
	]);
});

/** 検索の「本人が変わった」を、どの検索への応答かを見ずに信じる。 */
const trustEveryIdentityChange: m3.Machine = {
	offers,
	notify,
	receive: (s, r) =>
		s.kind === 'ログイン済み' && r.type === '検索の応答' && r.result.type === '本人が変わった'
			? { state: { kind: '未ログイン', error: identityChangedMessage, map: s.map }, effects: [] }
			: receive(s, r)
};

test('モデル3(検索) 対照: 前の本人の検索への 412 を信じると、本人が変わっていないのに画面を止める', () => {
	const result = check(
		m3.init,
		m3.stepsWith(trustEveryIdentityChange, m3.searching),
		m3.noFalseIdentityChange
	);
	expect(result).toMatchObject({ ok: false });
	expect(result.ok || result.trace.slice(-3)).toEqual([
		'閲覧者のログインが通る',
		'検索0(a1、管理者)の本人がセッションと違う',
		'検索0の応答(本人が変わった)が届く'
	]);
});
