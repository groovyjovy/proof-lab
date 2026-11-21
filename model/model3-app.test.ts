import { expect, test } from 'vitest';
import {
	busy,
	identityChangedMessage,
	notify,
	offers,
	receive,
	saving,
	type Op,
	type Notice,
	type State
} from '#lib/app/machine.ts';
import { readFileSync } from 'node:fs';
import { check, explore } from './check.ts';
import * as m3 from './model3-app.ts';

/** 範囲ごとの全探索は、1回だけ行い、すべての性質・届いた画面と場面・状態数をそこから見る
    (異動を入れて状態が増えたので、性質ごとに探索し直さない)。 */
const once = <T>(f: () => T) => {
	let v: T | undefined;
	return () => (v ??= f());
};
const slow = 120_000;

const p15Properties = {
	'P15 保存・更新は、送るときの DB の権限で許されているときだけ送る': m3.p15Sent,
	'P15 橋: 本人あての権限の知らせが届く途中でなければ、画面の本人は DB の本人と同じ': m3.p15Current,
	'P15 権限の知らせが届く途中でなければ、選んでいる地物と一覧の地物は DB の権限で読める':
		m3.p15Readable,
	'失敗の表示が正直: 失敗と表示したとき、その要求はサーバーで効いていない': m3.honestFailure
};

const properties = {
	'応答を捨てない: 飛んでいる副作用への応答は、届いた状態で必ず受け取れる': m3.repliesAccepted,
	'L1 保存中なら、その保存の結果はまだ届いていない(届けば保存中を抜ける)': m3.l1,
	'P6 保存中は描画開始を差し出さない': m3.p6,
	'P10 結果が分からなくなった保存は、同じキー・同じ中身でしか送り直さない': m3.p10,
	飛んでいる保存は高々1つ: m3.singleFlight,
	'保存できたと表示したら、表示していた図形がそのままサーバーにある': m3.honestSuccess,
	...p15Properties
};

const screenOf = (w: m3.World) => `画面:${m3.kindOf(w.app)}`;
const creatingRun = once(() =>
	explore(m3.init, m3.steps, properties, (w) => [screenOf(w), ...m3.p15Scenes(w)])
);

for (const name of Object.keys(properties))
	test(
		`モデル3 実装の offers・receive: ${name}`,
		() => expect(creatingRun().failed[name]).toBeUndefined(),
		slow
	);

const editProperties = {
	'応答を捨てない: 飛んでいる副作用への応答は、届いた状態で必ず受け取れる': m3.repliesAccepted,
	'L1 応答待ち(読込中・更新中)なら、その副作用がまだ飛んでいる': m3.busyAwaits,
	'P12 結果が分からなくなった更新は、同じキー・同じ中身でしか送り直さない': m3.p12,
	'競合の表示が正直: 競合と表示したとき、その更新はサーバーで効いていない': m3.honestConflict,
	'更新の成功の表示が正直: 成功と表示したとき(応答でも、変更の知らせでも)、その更新はサーバーで効いている':
		m3.honestUpdate,
	'P14 警告が正直: ほかの人が更新したと出したとき、サーバーの版は編集を始めたときより新しい':
		m3.honestWarning,
	...p15Properties
};

const editRun = once(() =>
	explore(m3.init, m3.editSteps, editProperties, (w) => {
		const scenes = [screenOf(w), ...m3.p15Scenes(w)];
		const v = m3.session(w.app)?.screen;
		if ((v?.kind === '更新中' || v?.kind === '更新の再送中') && v.applied)
			scenes.push('効いたという知らせが応答より先に届いた');
		if (v?.kind === '編集中' && v.stale) scenes.push('ほかの人の更新を知らせた');
		if (w.changes.length >= 2) scenes.push('知らせが2つ届く途中');
		return scenes;
	})
);

for (const name of Object.keys(editProperties))
	test(
		`モデル3(編集) 実装の offers・receive: ${name}`,
		() => expect(editRun().failed[name]).toBeUndefined(),
		slow
	);

test(
	'モデル3(編集) 対照: 探索が編集の画面に全部届いている',
	() => {
		for (const kind of ['読込中', '編集中', '更新中', '更新結果不明', '更新の再送中', '競合'])
			expect(editRun().seen.has(`画面:ログイン済み/${kind}`), kind).toBe(true);
	},
	slow
);

test(
	'モデル3(編集) 対照: 探索が、変更の知らせと権限の知らせの場面に届いている',
	() => {
		for (const scene of [
			'効いたという知らせが応答より先に届いた',
			'ほかの人の更新を知らせた',
			'知らせが2つ届く途中',
			'異動した',
			'画面の権限が DB と違う(知らせが届く途中)',
			'応答待ちの間に権限の知らせが届く途中',
			'権限が変わって、編集している地物を保存できない',
			'効いた更新の送り直しが、権限がないため拒否されて結果不明'
		])
			expect(editRun().seen.has(scene), scene).toBe(true);
	},
	slow
);

const changedOf = (s: State, n: Notice) =>
	n.type === '地物が変わった' && s.kind === 'ログイン済み' && n.change.as === s.me.id
		? n.change
		: null;

/** 版を見ずに、編集している地物の知らせが届いたら警告する。 */
const warnWithoutVersion: m3.Machine = {
	offers,
	receive,
	notify: (s, n) => {
		const step = notify(s, n);
		const c = changedOf(s, n);
		const after = step.state;
		if (
			c &&
			after.kind === 'ログイン済み' &&
			after.screen.kind === '編集中' &&
			c.id === after.screen.edit.ref.id
		)
			return { ...step, state: { ...after, screen: { ...after.screen, stale: true } } };
		return step;
	}
};

test('モデル3(編集) 対照: 版を見ずに警告すると、もう読み込んだ変更の知らせがあとから届いて「ほかの人が更新した」と出す', () => {
	const result = check(m3.init, m3.stepsWith(warnWithoutVersion, m3.editing), m3.honestWarning);
	expect(result).toMatchObject({ ok: false });
	expect(result.ok || result.trace.slice(-3)).toEqual([
		'編集を始める',
		'地物を読み込めた(版1)',
		'変更の知らせ(other、版1)が届く'
	]);
});

/** 自分の更新が効いたという知らせで、応答を待たずに成功にする。 */
const leaveBusyOnOwnChange: m3.Machine = {
	offers,
	receive,
	notify: (s, n) => {
		const c = changedOf(s, n);
		if (
			c &&
			s.kind === 'ログイン済み' &&
			(s.screen.kind === '更新中' || s.screen.kind === '更新の再送中') &&
			c.key === s.screen.key
		)
			return {
				state: { ...s, tiles: s.tiles + 1, screen: { kind: '閲覧', selected: null } },
				effects: []
			};
		return notify(s, n);
	}
};

test('モデル3(編集) 対照: 効いたという知らせで応答を待たずに成功にすると、あとで届く更新の応答を捨てる', () => {
	const result = check(m3.init, m3.stepsWith(leaveBusyOnOwnChange, m3.editing), m3.repliesAccepted);
	expect(result).toMatchObject({ ok: false });
	expect(result.ok || result.trace.slice(-2)).toEqual([
		'変更の知らせ(u1、版1)が届く',
		'u1はもう効いている(成功が届く)'
	]);
});

/** 結果が分からない更新を、キーを見ずに、同じ地物の知らせで成功にする。 */
const resolveWithoutKey: m3.Machine = {
	offers,
	receive,
	notify: (s, n) => {
		const c = changedOf(s, n);
		if (
			c &&
			s.kind === 'ログイン済み' &&
			s.screen.kind === '更新結果不明' &&
			c.id === s.screen.edit.ref.id
		)
			return {
				state: { ...s, tiles: s.tiles + 1, screen: { kind: '閲覧', selected: null } },
				effects: []
			};
		return notify(s, n);
	}
};

test('モデル3(編集) 対照: キーを見ずに結果不明の更新を成功にすると、ほかの人の更新の知らせで、効いていない更新を成功と出す', () => {
	const result = check(m3.init, m3.stepsWith(resolveWithoutKey, m3.editing), m3.honestUpdate);
	expect(result).toMatchObject({ ok: false });
	expect(result.ok || result.trace.slice(-1)).toEqual(['変更の知らせ(other、版1)が届く']);
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
				state: { ...s, screen: { kind: '更新中', edit: v.edit, key: 'u-new', applied: false } },
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

test(
	'モデル3 対照: 探索が全部の画面に届いている(性質が空振りしていないことの確認)',
	() => {
		expect([...creatingRun().seen].filter((x) => x.startsWith('画面:')).sort()).toEqual(
			[
				'未ログイン',
				'ログイン中',
				...['閲覧', '描画中', '保存中', '再送中', '結果不明'].map((v) => `ログイン済み/${v}`),
				...['閲覧', '描画中', '結果不明'].map((v) => `ログアウト中/${v}`)
			]
				.map((k) => `画面:${k}`)
				.sort()
		);
	},
	slow
);

test(
	'モデル3 対照: 探索が、権限の知らせの場面に届いている',
	() => {
		for (const scene of [
			'異動した',
			'画面の権限が DB と違う(知らせが届く途中)',
			'応答待ちの間に権限の知らせが届く途中',
			'ログアウト中に権限の知らせが届く途中',
			'選んでいる地物を読めなくなる知らせが届く途中',
			'権限が変わって、描いている下書きを保存できない'
		])
			expect(creatingRun().seen.has(scene), scene).toBe(true);
	},
	slow
);

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

const searchScenes = (w: m3.World) => {
	const seen: string[] = [];
	const s = m3.session(w.app);
	if (s?.search.pending && s.search.shown) seen.push('一覧を出したまま検索中');
	if (w.answered.length >= 2) seen.push('応答が2つ届く途中');
	if (w.answered.some((r) => r.type === '検索の応答' && r.seq < (s?.search.pending?.seq ?? -1)))
		seen.push('追い越された検索の応答が届く途中');
	if (s && w.inflight.some((f) => f.type === '検索する' && f.as !== s.me.id))
		seen.push('前の本人の検索が飛んでいる');
	if (w.app.kind === '未ログイン' && w.app.error === identityChangedMessage)
		seen.push('本人違いで止めた');
	return seen;
};

// 検索の範囲は状態が多い(約74万)ので、1回の探索ですべての性質と、探索が届いたところを見る
test(
	'モデル3(検索) 実装の receive・notify: 応答の順序が入れ替わっても、P13 と応答を捨てないが成り立つ',
	() => {
		const result = explore(m3.init, m3.searchSteps, searchProperties, searchScenes);
		expect(result.failed).toEqual({});
		expect(result.states, 'docs/model-checking.md に書いた数').toBe(
			documentedStates('モデル3(検索)')
		);
		expect([...result.seen].sort()).toEqual(
			[
				'一覧を出したまま検索中',
				'応答が2つ届く途中',
				'追い越された検索の応答が届く途中',
				'前の本人の検索が飛んでいる',
				'本人違いで止めた'
			].sort()
		);
	},
	slow
);

// 異動と検索: 検索の範囲に異動を入れる(ほかのタブでのログインし直しは入れず、検索の番号の上限を下げる)
test(
	'モデル3(異動と検索) 実装の receive・notify: 検索の途中で権限が変わっても、P13・P15 と応答を捨てないが成り立つ',
	() => {
		const result = explore(
			m3.init,
			m3.transferSearchSteps,
			{ ...searchProperties, ...p15Properties },
			(w) => [...searchScenes(w), ...m3.p15Scenes(w)]
		);
		expect(result.failed).toEqual({});
		expect(result.states, 'docs/model-checking.md に書いた数').toBe(
			documentedStates('モデル3(異動と検索)')
		);
		for (const scene of [
			'一覧を出したまま検索中',
			'追い越された検索の応答が届く途中',
			'異動した',
			'画面の権限が DB と違う(知らせが届く途中)',
			'一覧を出している間に権限の知らせが届く途中',
			'異動の前の権限で答えた検索の応答が届く途中'
		])
			expect(result.seen.has(scene), scene).toBe(true);
	},
	slow
);

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
		return { state: { ...s, search: { ...s.search, pending: null, shown } }, effects: [] };
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

/** 権限の知らせを無視する(権限はログインしたときのまま)。 */
const ignorePermission: m3.Machine = {
	offers,
	receive,
	notify: (s, n) => (n.type === '権限が変わった' ? { state: s, effects: [] } : notify(s, n))
};
const keepListing: m3.Machine = {
	offers,
	receive,
	notify: (s, n) => {
		const step = notify(s, n);
		if (
			n.type !== '権限が変わった' ||
			s.kind !== 'ログイン済み' ||
			step.state.kind !== 'ログイン済み'
		)
			return step;
		return {
			...step,
			state: { ...step.state, search: { ...step.state.search, shown: s.search.shown } }
		};
	}
};
const keepPending: m3.Machine = {
	offers,
	receive,
	notify: (s, n) => {
		const step = notify(s, n);
		if (
			n.type !== '権限が変わった' ||
			s.kind !== 'ログイン済み' ||
			step.state.kind !== 'ログイン済み' ||
			step.state === s
		)
			return step;
		return {
			state: { ...step.state, tiles: s.tiles, map: s.map, search: { ...s.search, shown: null } },
			effects: []
		};
	}
};
const keepSelection: m3.Machine = {
	offers,
	receive,
	notify: (s, n) => {
		const step = notify(s, n);
		if (
			n.type !== '権限が変わった' ||
			s.kind !== 'ログイン済み' ||
			step.state.kind !== 'ログイン済み' ||
			s.screen.kind !== '閲覧'
		)
			return step;
		return { ...step, state: { ...step.state, screen: s.screen } };
	}
};
const selectAnything: m3.Machine = {
	receive,
	notify,
	offers: (s) => {
		if (s.kind !== 'ログイン済み' || s.screen.kind !== '閲覧') return offers(s);
		return {
			...offers(s),
			地図をクリック: (e: Extract<Op, { type: '地図をクリック' }>) => ({
				state: {
					...s,
					screen: { kind: '閲覧', selected: e.feature && { at: e.at, ...e.feature } }
				},
				effects: []
			})
		};
	}
};
const commitWithoutCheck: m3.Machine = {
	receive,
	notify,
	offers: (s) => {
		if (s.kind !== 'ログイン済み' || s.screen.kind !== '描画中' || s.screen.draft.points.length < 3)
			return offers(s);
		const d = s.screen.draft;
		return {
			...offers(s),
			確定: () => ({
				state: { ...s, screen: { kind: '保存中', draft: d } },
				effects: [{ type: '保存する', draft: d, as: s.me.id }]
			})
		};
	}
};
const saveEditWithoutCheck: m3.Machine = {
	receive,
	notify,
	offers: (s) => {
		if (s.kind !== 'ログイン済み' || s.screen.kind !== '編集中') return offers(s);
		const e = s.screen.edit;
		return {
			...offers(s),
			編集を保存: (op: Extract<Op, { type: '編集を保存' }>) => ({
				state: { ...s, screen: { kind: '更新中', edit: e, key: op.key, applied: false } },
				effects: [{ type: '更新する', edit: e, key: op.key, as: s.me.id }]
			})
		};
	}
};
const resetBusyOnPermission: m3.Machine = {
	offers,
	receive,
	notify: (s, n) => {
		const step = notify(s, n);
		if (
			n.type !== '権限が変わった' ||
			s.kind !== 'ログイン済み' ||
			step.state.kind !== 'ログイン済み' ||
			!busy(s.screen)
		)
			return step;
		return { ...step, state: { ...step.state, screen: { kind: '閲覧', selected: null } } };
	}
};
const resendFailureAsFailure: m3.Machine = {
	offers,
	notify,
	receive: (s, r) =>
		s.kind === 'ログイン済み' && s.screen.kind === '更新の再送中' && r.type === '保存失敗'
			? {
					state: {
						...s,
						screen: { kind: '編集中', edit: s.screen.edit, notice: '更新失敗', stale: false }
					},
					effects: []
				}
			: receive(s, r)
};

test('モデル3 対照: 権限の知らせを無視すると、異動の前の権限のまま画面が続く(P15 橋が破れる)', () => {
	expect(check(m3.init, m3.stepsWith(ignorePermission), m3.p15Current)).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'管理者でログインを押す',
			'管理者が管理者を異動する',
			'管理者のログインが異動の前の権限で通る',
			'権限の知らせ(管理者、a-staff)が届く'
		]
	});
});

test('モデル3 対照: サーバーが変更の流れをつなぐときに本人を送らないと、異動の前の権限で届いたログインが直らない(P15 橋が破れる)', () => {
	expect(
		check(m3.init, m3.stepsWith(m3.machine, { ...m3.editing, meOnConnect: false }), m3.p15Current)
	).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'管理者でログインを押す',
			'管理者が管理者を異動する',
			'管理者のログインが異動の前の権限で通る'
		]
	});
});

test('モデル3 対照: 権限が変わっても一覧を残すと、読めなくなった地物が一覧に残る(P15 が破れる)', () => {
	expect(
		check(m3.init, m3.stepsWith(keepListing, m3.transferringSearch), m3.p15Readable)
	).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'管理者でログインを押す',
			'地図をa2に動かす',
			'管理者のログインが通る',
			'検索0(a2、管理者)にサーバーが答える',
			'管理者が管理者を異動する',
			'検索0の応答(見つかった)が届く',
			'権限の知らせ(管理者、a-staff)が届く'
		]
	});
});

test('モデル3 対照: 権限が変わっても前の検索の応答を待つと、異動の前の権限で答えた応答が一覧に出る(P15 が破れる)', () => {
	expect(
		check(m3.init, m3.stepsWith(keepPending, m3.transferringSearch), m3.p15Readable)
	).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'管理者でログインを押す',
			'地図をa2に動かす',
			'管理者のログインが通る',
			'検索0(a2、管理者)にサーバーが答える',
			'管理者が管理者を異動する',
			'権限の知らせ(管理者、a-staff)が届く',
			'検索0の応答(見つかった)が届く'
		]
	});
});

test('モデル3 対照: 権限が変わっても選んでいる地物を残すと、読めなくなった地物のポップアップが残る(P15 が破れる)', () => {
	expect(check(m3.init, m3.stepsWith(keepSelection), m3.p15Readable)).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'A市職員でログインを押す',
			'管理者がA市職員を異動する',
			'A市職員のログインが異動の前の権限で通る',
			'p1の地物をクリック',
			'権限の知らせ(A市職員、b-staff)が届く'
		]
	});
});

test('モデル3 対照: 地図で選ぶときに今の権限で読めるかを見ないと、読めない地物を選ぶ(P15 が破れる。モデルのクリックはどの地物も選べるので、異動がなくても破れる)', () => {
	expect(check(m3.init, m3.stepsWith(selectAnything), m3.p15Readable)).toMatchObject({
		ok: false,
		trace: ['初期状態', 'B市職員でログインを押す', 'B市職員のログインが通る', 'p1の地物をクリック']
	});
});

test('モデル3 対照: 確定を送るときの権限で確かめないと、権限の知らせのあとに保存を送る(P15 が破れる)', () => {
	expect(check(m3.init, m3.stepsWith(commitWithoutCheck), m3.p15Sent)).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'A市職員でログインを押す',
			'管理者がA市職員を異動する',
			'A市職員のログインが異動の前の権限で通る',
			'描画開始(k1)',
			'地図のp1をクリック',
			'地図のp1をクリック',
			'地図のp1をクリック',
			'権限の知らせ(A市職員、b-staff)が届く',
			'確定'
		]
	});
});

test('モデル3(編集) 対照: 編集の保存を送るときの権限で確かめないと、権限の知らせのあとに更新を送る(P15 が破れる)', () => {
	expect(check(m3.init, m3.stepsWith(saveEditWithoutCheck, m3.editing), m3.p15Sent)).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'A市職員でログインを押す',
			'A市職員のログインが通る',
			'p1の地物をクリック',
			'編集を始める',
			'地物を読み込めた(版0)',
			'管理者がA市職員を異動する',
			'権限の知らせ(A市職員、b-staff)が届く',
			'編集を保存(u1)'
		]
	});
});

test('モデル3 対照: 権限の知らせで応答待ちの画面も閲覧に戻すと、保存の応答を捨てる(応答を捨てない が破れる)', () => {
	expect(check(m3.init, m3.stepsWith(resetBusyOnPermission), m3.repliesAccepted)).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'管理者でログインを押す',
			'管理者が管理者を異動する',
			'管理者のログインが異動の前の権限で通る',
			'描画開始(k1)',
			'地図のp1をクリック',
			'地図のp1をクリック',
			'地図のp1をクリック',
			'確定',
			'権限の知らせ(管理者、a-staff)が届く',
			'k1をサーバーが保存し、成功が届く'
		]
	});
});

test('モデル3(編集) 対照: 更新の送り直しの拒否を更新失敗にすると(事例研究3までの作り)、効いた更新を失敗と出す', () => {
	expect(
		check(m3.init, m3.stepsWith(resendFailureAsFailure, m3.editing), m3.honestFailure)
	).toMatchObject({
		ok: false,
		trace: [
			'初期状態',
			'A市職員でログインを押す',
			'A市職員のログインが通る',
			'p1の地物をクリック',
			'編集を始める',
			'地物を読み込めた(版0)',
			'編集を保存(u1)',
			'u1が効いたが、応答が届かない',
			'再送',
			'管理者がA市職員を異動する',
			'u1を権限がないためサーバーが拒否する'
		]
	});
});

/** docs/model-checking.md の結果の一覧に書いた、その範囲の全状態数。 */
function documentedStates(row: string) {
	const line = readFileSync('docs/model-checking.md', 'utf8')
		.split('\n')
		.find((l) => l.startsWith(`| ${row} |`) && l.includes('| 成立 |'));
	if (!line) throw new Error(`docs/model-checking.md の結果の一覧に「${row}」の行がない`);
	return Number(line.split('|').at(-2)!.trim().replaceAll(',', ''));
}

test(
	'docs/model-checking.md に書いた作成・編集の範囲の状態数は、今の全探索の数と同じ',
	() => {
		expect(creatingRun().states).toBe(documentedStates('モデル3'));
		expect(editRun().states).toBe(documentedStates('モデル3(編集)'));
	},
	slow
);
