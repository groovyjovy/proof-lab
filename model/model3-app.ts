// モデル3: 実装の状態機械(src/lib/app/machine.ts の offers と receive)をそのまま、通信とサーバーの環境と一緒に検査する。
// 書き直したモデルではないので、ここで出た反例は実装の反例。範囲を区切った全探索で、範囲なしの証明は spec/ にある。
import type { Me } from '#lib/domain.ts';
import {
	identityChangedMessage,
	notify,
	offers,
	perform,
	receive,
	busy,
	saving,
	type Area,
	type Draft,
	type Effect,
	type Hit,
	type LoggedIn,
	type Op,
	type Point,
	type Reply,
	type State,
	type Step as AppStep
} from '#lib/app/machine.ts';
import type { Step } from './check.ts';

export type World = {
	app: State;
	inflight: Effect[];
	stored: Record<string, string>;
	sent: Record<string, string>;
	doubtful: string[];
	keysUsed: number;
	loginsUsed: number;
	/** 編集できる地物(id 1)のサーバーの行。版と、効かせた更新のキー(P12) */
	row: { version: number; applied: string[] };
	updatesUsed: number;
	othersUsed: number;
	/** サーバーが答えたが、まだ届いていない検索の応答。届く順番は決まっていない */
	answered: Reply[];
	/** サーバーのセッションの本人(検索の範囲でだけ追う)。ほかのタブでログインし直すと変わる */
	serverUser: string | null;
	movesUsed: number;
	otherTabsUsed: number;
	broken: string[];
};

const users: Record<string, Me> = {
	'admin@example.com': { id: 'u-admin', name: '管理者', role: 'admin', canEdit: true },
	'a-staff@example.com': { id: 'u-a', name: 'A市職員', role: 'a-staff', canEdit: true },
	'b-staff@example.com': { id: 'u-b', name: 'B市職員', role: 'b-staff', canEdit: true },
	'viewer@example.com': { id: 'u-viewer', name: '閲覧者', role: 'viewer', canEdit: false }
};
const points: Record<string, Point> = { p1: [0, 0] };
const maxKeys = 2;
const maxLogins = 2;
const maxPoints = 4;
const maxUpdates = 2;
const maxOthers = 1;
const feature1 = { ref: { id: 1, city: 'A' as const, public: true }, properties: { name: 'p1' } };

/** 検索の範囲の地図。範囲 a1 に公開の地物と非公開の地物、範囲 a2 に公開の地物がある。 */
const areas: Record<string, Area> = {
	a1: [
		[0, 0],
		[1, 1]
	],
	a2: [
		[1, 1],
		[2, 2]
	]
};
const located: { hit: Hit; area: string }[] = [
	{ hit: { ref: { id: 1, city: 'A', public: true }, properties: { name: 'f1' } }, area: 'a1' },
	{ hit: { ref: { id: 2, city: 'A', public: false }, properties: { name: 'f2' } }, area: 'a1' },
	{ hit: { ref: { id: 3, city: 'B', public: true }, properties: { name: 'f3' } }, area: 'a2' }
];
const searchers = ['admin@example.com', 'viewer@example.com'];
const maxMoves = 2;
/** 検索の範囲で振る番号の上限(ログアウトに失敗するたびに検索し直すので、上限がないと状態が尽きない) */
const maxSearches = 4;
const maxOtherTabs = 1;
const areaName = (a: Area) =>
	Object.keys(areas).find((k) => JSON.stringify(areas[k]) === JSON.stringify(a)) ?? '?';
const userById = (id: string) => Object.values(users).find((u) => u.id === id);
/** 読める地物(認可の仕様の readCond を、管理者と閲覧者に絞ったもの)。 */
const readable = (me: Me, h: Hit) => me.role === 'admin' || h.ref.public;
const hitsFor = (me: Me, area: Area) =>
	located.filter((f) => f.area === areaName(area) && readable(me, f.hit)).map((f) => f.hit);

export const init: World = {
	app: { kind: '未ログイン', error: null, map: { area: null, issued: 0 } },
	inflight: [],
	stored: {},
	sent: {},
	doubtful: [],
	keysUsed: 0,
	loginsUsed: 0,
	row: { version: 0, applied: [] },
	updatesUsed: 0,
	othersUsed: 0,
	answered: [],
	serverUser: null,
	movesUsed: 0,
	otherTabsUsed: 0,
	broken: []
};

export const session = (app: State): LoggedIn | null =>
	app.kind === 'ログイン済み' ? app : app.kind === 'ログアウト中' ? app.from : null;

const content = (d: Draft) => JSON.stringify([d.city, d.public, d.points]);
const savingKey = (app: State) => {
	const v = session(app)?.screen;
	return v && saving(v) ? v.draft.key : null;
};

export type Machine = { offers: typeof offers; receive: typeof receive; notify: typeof notify };
export const machine: Machine = { offers, receive, notify };

function apply(w: World, { state, effects }: AppStep, server: Partial<World> = {}): World {
	const broken = new Set(w.broken);
	const sent = { ...w.sent };
	const doubtful = server.doubtful ?? w.doubtful;
	for (const f of effects) {
		if (f.type !== '保存する') continue;
		if (doubtful.includes(f.draft.key) && sent[f.draft.key] !== content(f.draft)) broken.add('P10');
		sent[f.draft.key] = content(f.draft);
	}
	const stored = server.stored ?? w.stored;
	const row = server.row ?? w.row;
	const before = session(w.app)?.screen;
	const after = session(state);
	const refreshed = after !== null && after.tiles > (session(w.app)?.tiles ?? Infinity);
	if (before && saving(before) && after?.screen.kind === '閲覧' && refreshed)
		if (stored[before.draft.key] !== content(before.draft)) broken.add('成功の表示');
	if (before?.kind === '更新結果不明')
		for (const f of effects)
			if (
				f.type === '更新する' &&
				(f.key !== before.key || JSON.stringify(f.edit) !== JSON.stringify(before.edit))
			)
				broken.add('P12');
	// 本人が変わっていないのに、本人違いとして画面を止めない(前の本人の検索への 412 を信じない)
	const was = session(w.app);
	if (
		w.app.kind === 'ログイン済み' &&
		was &&
		state.kind === '未ログイン' &&
		state.error === identityChangedMessage &&
		w.serverUser === was.me.id
	)
		broken.add('本人違いでないのに止めた');
	if (before?.kind === '更新中') {
		const applied = row.applied.includes(before.key);
		if (after?.screen.kind === '競合' && applied) broken.add('競合の表示');
		if (after?.screen.kind === '閲覧' && refreshed && !applied) broken.add('更新の成功の表示');
	}
	return {
		...w,
		...server,
		app: state,
		inflight: [...(server.inflight ?? w.inflight), ...effects],
		sent,
		doubtful,
		broken: [...broken].sort()
	};
}

function sampleOps(w: World, env: Environment): [string, Op][] {
	const ops = allOps(w);
	const editing = ['編集を始める', '名前を変える', '編集を保存', '読み直す'];
	switch (env.scope) {
		case '作成':
			return ops.filter(([, op]) => !editing.includes(op.type));
		case '編集':
			return ops.filter(([, op]) => op.type !== '描画開始');
		case '検索':
			return ops.filter(
				([, op]) =>
					op.type === 'ログアウトを押す' ||
					(op.type === 'ログインを押す' && searchers.includes(op.email))
			);
	}
}

function allOps(w: World): [string, Op][] {
	const v = session(w.app)?.screen;
	const full = v !== undefined && 'draft' in v && v.draft.points.length >= maxPoints;
	return [
		...(w.loginsUsed < maxLogins
			? Object.keys(users).map((email): [string, Op] => [
					`${users[email].name}でログインを押す`,
					{ type: 'ログインを押す', email }
				])
			: []),
		['ログアウトを押す', { type: 'ログアウトを押す' }],
		...(full
			? []
			: Object.entries(points).flatMap(([name, at]): [string, Op][] => [
					[`地図の${name}をクリック`, { type: '地図をクリック', at, feature: null }],
					[`${name}の地物をクリック`, { type: '地図をクリック', at, feature: feature1 }]
				])),
		['ポップアップを閉じる', { type: 'ポップアップを閉じる' }],
		...(w.keysUsed < maxKeys
			? [
					[`描画開始(k${w.keysUsed + 1})`, { type: '描画開始', key: `k${w.keysUsed + 1}` }] as [
						string,
						Op
					]
				]
			: []),
		['A市を選ぶ', { type: '市を選ぶ', city: 'A' }],
		['B市を選ぶ', { type: '市を選ぶ', city: 'B' }],
		['公開にする', { type: '公開を選ぶ', public: true }],
		['確定', { type: '確定' }],
		['取消', { type: '取消' }],
		['再送', { type: '再送' }],
		['編集を始める', { type: '編集を始める' }],
		['名前を変える', { type: '名前を変える', name: 'n1' }],
		...(w.updatesUsed < maxUpdates
			? [
					[
						`編集を保存(u${w.updatesUsed + 1})`,
						{ type: '編集を保存', key: `u${w.updatesUsed + 1}` }
					] as [string, Op]
				]
			: []),
		['読み直す', { type: '読み直す' }]
	];
}

/** サーバーの更新(`saveFeature`)。キーを記録する(P12)。`idempotent` を外すと、キーを見ない素朴な更新になる。 */
function updateOutcomes(
	w: World,
	edit: { version: number },
	key: string,
	idempotent: boolean
): [string, Reply, Partial<World>][] {
	const failures: [string, Reply, Partial<World>][] = [
		[`${key}をサーバーが拒否する`, { type: '保存失敗' }, {}],
		[`${key}の要求がサーバーに届かない`, { type: '保存結果不明' }, {}],
		[`${key}の要求の本人がセッションと違う`, { type: '本人が変わった' }, {}]
	];
	if (idempotent && w.row.applied.includes(key))
		return [[`${key}はもう効いている(成功が届く)`, { type: '保存成功' }, {}], ...failures];
	if (edit.version !== w.row.version)
		return [[`${key}は版が古く、競合が届く`, { type: '競合した' }, {}], ...failures];
	const row = { version: w.row.version + 1, applied: [...w.row.applied, key] };
	return [
		[`${key}が効き、成功が届く`, { type: '保存成功' }, { row }],
		[`${key}が効いたが、応答が届かない`, { type: '保存結果不明' }, { row }],
		...failures
	];
}

function deliveries(f: Effect, w: World, env: Environment): [string, Reply, Partial<World>][] {
	switch (f.type) {
		case 'ログインする':
			return [
				[
					`${users[f.email].name}のログインが通る`,
					{ type: 'ログイン成功', me: users[f.email] },
					{}
				],
				['ログインが失敗する', { type: 'ログイン失敗', message: '失敗' }, {}]
			];
		case 'ログアウトする':
			return [
				['ログアウトが通る', { type: 'ログアウト完了' }, {}],
				['ログアウトが失敗する', { type: 'ログアウト失敗' }, {}]
			];
		case '保存する': {
			const { key } = f.draft;
			const stored = { ...w.stored, [key]: w.stored[key] ?? content(f.draft) };
			const doubtful = [...new Set([...w.doubtful, key])].sort();
			return [
				[`${key}をサーバーが保存し、成功が届く`, { type: '保存成功' }, { stored }],
				[`${key}をサーバーが拒否する`, { type: '保存失敗' }, {}],
				[
					`${key}をサーバーが保存したが、応答が届かない`,
					{ type: '保存結果不明' },
					{ stored, doubtful }
				],
				[`${key}の要求がサーバーに届かない`, { type: '保存結果不明' }, { doubtful }],
				[`${key}の要求の本人がセッションと違う`, { type: '本人が変わった' }, {}]
			];
		}
		case '読み込む':
			return [
				[
					`地物を読み込めた(版${w.row.version})`,
					{
						type: '読み込めた',
						edit: { ref: feature1.ref, version: w.row.version, name: '元の名前', note: '' }
					},
					{}
				],
				['地物を読み込めない', { type: '読み込めない' }, {}],
				['読み込みの本人がセッションと違う', { type: '本人が変わった' }, {}]
			];
		case '更新する':
			return updateOutcomes(w, f.edit, f.key, env.idempotentUpdates);
		case '検索する':
			return [];
	}
}

/** サーバーが検索に答える。答えるのは、そのときのセッションの本人として(届くのはもっとあと)。 */
function searchAnswers(f: Extract<Effect, { type: '検索する' }>, w: World): [string, Reply][] {
	const n = `検索${f.query.seq}(${areaName(f.query.area)}、${userById(f.as)?.name})`;
	const reply = (result: Extract<Reply, { type: '検索の応答' }>['result']): Reply => ({
		type: '検索の応答',
		seq: f.query.seq,
		result
	});
	const failed: [string, Reply] = [`${n}にサーバーが答えられない`, reply({ type: '検索できない' })];
	if (w.serverUser === null) return [failed];
	if (w.serverUser !== f.as)
		return [[`${n}の本人がセッションと違う`, reply({ type: '本人が変わった' })], failed];
	const me = userById(f.as)!;
	return [
		[`${n}にサーバーが答える`, reply({ type: '見つかった', hits: hitsFor(me, f.query.area) })],
		failed
	];
}

const replyLabel = (r: Reply) =>
	r.type === '検索の応答' ? `検索${r.seq}の応答(${r.result.type})が届く` : r.type;

/**
 * 検査の範囲とサーバーの性質。作成(描画と保存)と編集は独立した流れなので、別々に全探索する
 * (1つの世界に入れると、サーバーの状態が掛け算で増えて、メモリに収まらない)。
 * 既定のサーバーは実装のとおり(更新はキーで冪等)。
 */
export type Environment = { scope: '作成' | '編集' | '検索'; idempotentUpdates: boolean };
export const creating: Environment = { scope: '作成', idempotentUpdates: true };
export const editing: Environment = { scope: '編集', idempotentUpdates: true };
/** 範囲の検索: 地図を動かし、検索の応答が送った順と違う順に届く。ログインし直す前の本人の応答も届く。 */
export const searching: Environment = { scope: '検索', idempotentUpdates: true };

// 利用者は、画面に差し出された操作だけを行う(画面はそれ以外の操作を送れない)。
// 環境は、飛んでいる副作用のどれかに、ありうる応答のどれかを返す。受け取れない応答は「応答を捨てた」として記録する。
// 地図ライブラリからの知らせ(タイルの本人違い)は、いつでも届く(検索の範囲では、本人が本当に変わったときだけ)。
// 検索は、サーバーが答える時点と、応答が届く時点を分ける(答えたあとにログインし直すこともある)。
export const stepsWith =
	(m: Machine, env: Environment = creating) =>
	(w: World): Step<World>[] => {
		const tracked = env.scope === '検索';
		const out: Step<World>[] = [];
		const offered = m.offers(w.app);
		for (const [label, op] of sampleOps(w, env)) {
			const step = perform(offered, op);
			if (!step) continue;
			out.push([
				label,
				{
					...apply(w, step),
					keysUsed: w.keysUsed + (op.type === '描画開始' ? 1 : 0),
					loginsUsed: w.loginsUsed + (op.type === 'ログインを押す' ? 1 : 0),
					updatesUsed: w.updatesUsed + (op.type === '編集を保存' ? 1 : 0)
				}
			]);
		}
		const me = session(w.app)?.me.id;
		if (!tracked || (me !== undefined && w.serverUser !== me))
			out.push([
				'地図の本人が変わった',
				apply(w, m.notify(w.app, { type: '地図の本人が変わった' }))
			]);
		if (tracked && w.movesUsed < maxMoves)
			for (const [name, area] of Object.entries(areas))
				out.push([
					`地図を${name}に動かす`,
					{
						...apply(w, m.notify(w.app, { type: '地図が動いた', area })),
						movesUsed: w.movesUsed + 1
					}
				]);
		if (tracked && w.serverUser !== null && w.otherTabsUsed < maxOtherTabs)
			out.push([
				'ほかのタブで別の人がログインし直す',
				{
					...w,
					serverUser: w.serverUser === users['admin@example.com'].id ? 'u-viewer' : 'u-admin',
					otherTabsUsed: w.otherTabsUsed + 1
				}
			]);
		if (env.scope === '編集' && w.othersUsed < maxOthers)
			out.push([
				'ほかの人が地物を更新する',
				{
					...w,
					row: { ...w.row, version: w.row.version + 1 },
					othersUsed: w.othersUsed + 1
				}
			]);
		w.inflight.forEach((f, i) => {
			const inflight = w.inflight.filter((_, j) => j !== i);
			if (f.type === '検索する') {
				for (const [label, reply] of searchAnswers(f, w))
					out.push([label, { ...w, inflight, answered: canonical([...w.answered, reply]) }]);
				return;
			}
			for (const [label, reply, rawServer] of deliveries(f, w, env)) {
				const server = tracked
					? { ...rawServer, serverUser: serverUserAfter(w, reply) }
					: rawServer;
				const step = m.receive(w.app, reply);
				out.push([
					label,
					step
						? apply(w, step, { ...server, inflight })
						: {
								...w,
								...server,
								inflight,
								broken: [...new Set([...w.broken, '応答を捨てた'])].sort()
							}
				]);
			}
		});
		w.answered.forEach((reply, i) => {
			const answered = w.answered.filter((_, j) => j !== i);
			const step = m.receive(w.app, reply);
			out.push([
				replyLabel(reply),
				step
					? apply(w, step, { answered })
					: { ...w, answered, broken: [...new Set([...w.broken, '応答を捨てた'])].sort() }
			]);
		});
		return tracked ? out.filter(([, next]) => mapOf(next.app).issued <= maxSearches) : out;
	};

const mapOf = (app: State) => (app.kind === 'ログアウト中' ? app.from.map : app.map);

/** 届く順番は決まっていないので、届く途中の応答は並べ替えておく(同じ状態を2度数えない)。 */
const canonical = (replies: Reply[]) =>
	replies
		.map((r) => JSON.stringify(r))
		.sort()
		.map((r) => JSON.parse(r) as Reply);

/** このタブのログイン・ログアウトが通ると、サーバーのセッションの本人が変わる。 */
const serverUserAfter = (w: World, r: Reply) =>
	r.type === 'ログイン成功' ? r.me.id : r.type === 'ログアウト完了' ? null : w.serverUser;

export const steps = stepsWith(machine);
export const editSteps = stepsWith(machine, editing);
export const searchSteps = stepsWith(machine, searching);

// 応答を捨てない: 飛んでいる副作用への応答は、届いた状態で必ず受け取れる
export const repliesAccepted = (w: World) => !w.broken.includes('応答を捨てた');

// L1: 保存中(ログアウト中に隠れている場合も含む)なら、その保存の結果がまだ届いていない
export const l1 = (w: World) => {
	const key = savingKey(w.app);
	return key === null || w.inflight.some((f) => f.type === '保存する' && f.draft.key === key);
};

// 飛んでいる保存は高々1つ(だから保存の結果に、どの保存の結果かを書かなくてよい)
export const singleFlight = (w: World) =>
	w.inflight.filter((f) => f.type === '保存する').length <= 1;

// P6: 保存中は、描画開始を差し出さない(だから新しい描画は始まらない)
export const p6 = (w: World) => savingKey(w.app) === null || !offers(w.app).描画開始;

// P10: 結果が分からなくなった保存は、同じキー・同じ中身でしか送り直さない(サーバーは同じキーを1つしか保存しないので、二重にならない)
export const p10 = (w: World) => !w.broken.includes('P10');

// 保存できたと表示したら、表示していた図形がそのままサーバーにある
export const honestSuccess = (w: World) => !w.broken.includes('成功の表示');

// 編集できない人は描けない。市職員は自分の市にしか描けない
export const drawPermission = (w: World) => {
	const s = session(w.app);
	if (!s || !('draft' in s.screen)) return true;
	if (!s.me.canEdit) return false;
	return s.me.role === 'admin' || s.screen.draft.city === (s.me.role === 'b-staff' ? 'B' : 'A');
};

// P12: 結果が分からなくなった更新は、同じキー・同じ中身でしか送り直さない
export const p12 = (w: World) => !w.broken.includes('P12');

// 応答待ち(保存中・読込中・更新中)なら、その副作用がまだ飛んでいる(届けば応答待ちを抜ける)
export const busyAwaits = (w: World) => {
	const v = session(w.app)?.screen;
	return !v || !busy(v) || w.inflight.some((f) => f.type !== 'ログアウトする');
};

// 競合の表示が正直: 競合と表示したとき、その更新はサーバーで効いていない(P12)
export const honestConflict = (w: World) => !w.broken.includes('競合の表示');

// 更新の成功の表示が正直: 成功と表示したとき、その更新はサーバーで効いている
export const honestUpdate = (w: World) => !w.broken.includes('更新の成功の表示');

// P13: 一覧に出している地物は、今の本人が読めるものだけ(前の本人への検索の応答を出さない)
export const p13Readable = (w: World) => {
	const s = session(w.app);
	const l = s?.search.shown;
	return !s || l?.kind !== '見つかった' || l.hits.every((h) => readable(s.me, h));
};

// P13: 一覧の地物は、一覧が示す範囲のもの(追い越された検索の応答を、新しい範囲の一覧として出さない)
export const p13Matches = (w: World) => {
	const l = session(w.app)?.search.shown;
	return (
		l?.kind !== '見つかった' ||
		l.hits.every(
			(h) => located.find((f) => f.hit.ref.id === h.ref.id)?.area === areaName(l.query.area)
		)
	);
};

// P13: 検索中でなければ、一覧は今見えている範囲のもの
export const p13Settled = (w: World) =>
	w.app.kind !== 'ログイン済み' ||
	w.app.search.pending !== null ||
	JSON.stringify(w.app.search.shown?.query.area ?? null) === JSON.stringify(w.app.map.area);

// 検索中なら、その検索は今の本人として、サーバーにあるか、応答が届く途中にある(届けば検索中を抜ける)
export const searchAwaits = (w: World) => {
	if (w.app.kind !== 'ログイン済み' || !w.app.search.pending) return true;
	const { seq } = w.app.search.pending;
	const me = w.app.me.id;
	return (
		w.inflight.some((f) => f.type === '検索する' && f.query.seq === seq && f.as === me) ||
		w.answered.some((r) => r.type === '検索の応答' && r.seq === seq)
	);
};

// 本人が変わっていないのに、本人違いとして画面を止めない
export const noFalseIdentityChange = (w: World) => !w.broken.includes('本人違いでないのに止めた');

export const kindOf = (app: State) => {
	const s = session(app);
	return s ? `${app.kind}/${s.screen.kind}` : app.kind;
};
