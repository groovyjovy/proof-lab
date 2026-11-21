// モデル3: 実装の状態機械(src/lib/app/machine.ts の offers と receive)をそのまま、通信とサーバーの環境と一緒に検査する。
// 書き直したモデルではないので、ここで出た反例は実装の反例。範囲を区切った全探索で、範囲なしの証明は spec/ にある。
import { canRead, canWrite, type Me } from '#lib/domain.ts';
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
	type Notice,
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
	/** サーバーが出したが、まだ届いていない変更の知らせ(編集の範囲)。届く順番は決まっていない */
	changes: Notice[];
	resumesUsed: number;
	/** サーバーのセッションの本人(検索の範囲でだけ追う)。ほかのタブでログインし直すと変わる */
	serverUser: string | null;
	movesUsed: number;
	otherTabsUsed: number;
	/** DB の本人の行のうち、異動で変わったもの(異動は1回まで)。サーバーは、答えるときの DB の権限で答える */
	transferred: Me | null;
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
/** 異動と検索の範囲で振る番号の上限(異動を入れると状態が増えるので、検索の範囲より絞る) */
const maxSearchesWithTransfer = 3;
const areaName = (a: Area) =>
	Object.keys(areas).find((k) => JSON.stringify(areas[k]) === JSON.stringify(a)) ?? '?';
const userById = (id: string) => Object.values(users).find((u) => u.id === id);
const hitsFor = (me: Me, area: Area) =>
	located.filter((f) => f.area === areaName(area) && canRead(me, f.hit.ref)).map((f) => f.hit);

/** DB の本人の行。異動したら、その行が変わる(P15)。 */
const dbMe = (w: World, id: string): Me =>
	w.transferred?.id === id ? w.transferred : (userById(id) as Me);
/** 管理者が行う異動(本人ごとに1通り)。管理者は A市職員に(B市に描けず、B市の地物を読めなくなる)、
    A市職員は B市に移り(A市の地物1を読めず、書けなくなる)、B市職員は編集権限を外され、
    閲覧者は A市職員(編集できる)になる。 */
const transferOf = (me: Me): Me =>
	me.role === 'admin'
		? { ...me, role: 'a-staff' }
		: me.role === 'a-staff'
			? { ...me, role: 'b-staff' }
			: me.role === 'b-staff'
				? { ...me, canEdit: false }
				: { ...me, role: 'a-staff', canEdit: true };
const same = (a: Me, b: Me) => JSON.stringify(a) === JSON.stringify(b);
/** 本人あての権限の知らせが、届く途中にある */
const permissionPending = (w: World, id: string) =>
	w.changes.some((n) => n.type === '権限が変わった' && n.me.id === id);

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
	changes: [],
	resumesUsed: 0,
	serverUser: null,
	movesUsed: 0,
	otherTabsUsed: 0,
	transferred: null,
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

/** 何で状態が変わったか。結果不明の更新を「やめる」のは利用者の操作で、成功の表示ではない */
type Source = '操作' | '応答' | '知らせ';

function apply(
	w: World,
	{ state, effects }: AppStep,
	server: Partial<World> = {},
	source: Source = '応答'
): World {
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
	if (before?.kind === '更新中' || before?.kind === '更新の再送中') {
		const applied = row.applied.includes(before.key);
		if (after?.screen.kind === '競合' && applied) broken.add('競合の表示');
		if (after?.screen.kind === '閲覧' && refreshed && !applied) broken.add('更新の成功の表示');
	}
	// 結果不明の更新を、知らせで成功にしたなら、そのキーは効いている(P14)
	if (before?.kind === '更新結果不明' && source !== '操作' && after?.screen.kind === '閲覧')
		if (!row.applied.includes(before.key)) broken.add('更新の成功の表示');
	// 「ほかの人が更新した」と出したなら、サーバーの版は編集を始めたときより新しい(P14)
	if (
		after?.screen.kind === '編集中' &&
		after.screen.stale &&
		!(before?.kind === '編集中' && before.stale) &&
		!(row.version > after.screen.edit.version)
	)
		broken.add('警告の表示');
	// P15: 保存・更新を送るのは、送るときの DB の権限で許されているときだけ(権限の知らせが届く途中か、
	// 結果不明の送り直しを除く。送り直しは同じキーで、サーバーが判断する)
	if (source === '操作')
		for (const f of effects) {
			if ((f.type !== '保存する' && f.type !== '更新する') || permissionPending(w, f.as)) continue;
			const me = dbMe(w, f.as);
			if (f.type === '保存する' && before?.kind !== '結果不明' && !canWrite(me, f.draft))
				broken.add('P15');
			if (f.type === '更新する' && before?.kind !== '更新結果不明' && !canWrite(me, f.edit.ref))
				broken.add('P15');
		}
	// 失敗と表示したなら、その要求は効いていない(効いたかもしれないなら、結果不明と表示する)
	if (
		(before?.kind === '更新中' || before?.kind === '更新の再送中') &&
		after?.screen.kind === '編集中' &&
		after.screen.notice === '更新失敗' &&
		row.applied.includes(before.key)
	)
		broken.add('更新の失敗の表示');
	if (
		before?.kind === '保存中' &&
		after?.screen.kind === '描画中' &&
		after.screen.notice === '保存失敗' &&
		stored[before.draft.key] !== undefined
	)
		broken.add('保存の失敗の表示');
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
		case '異動と検索':
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
					[
						`${name}の地物をクリック`,
						{
							type: '地図をクリック',
							at,
							feature: { ...feature1, ref: { ...feature1.ref, version: w.row.version } }
						}
					]
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
	f: Extract<Effect, { type: '更新する' }>,
	idempotent: boolean
): [string, Reply, Partial<World>][] {
	const { edit, key } = f;
	const lost: [string, Reply, Partial<World>][] = [
		[`${key}の要求がサーバーに届かない`, { type: '保存結果不明' }, {}],
		[`${key}の要求の本人がセッションと違う`, { type: '本人が変わった' }, {}]
	];
	const failures: [string, Reply, Partial<World>][] = [
		[`${key}をサーバーが拒否する`, { type: '保存失敗' }, {}],
		...lost
	];
	// 書き込めない人の更新は、同じキーがもう効いていても 403(RLS が、キーを見るより先に効く。
	// tests/properties/p15-permission-change.test.ts で測った)
	if (!canWrite(dbMe(w, f.as), edit.ref))
		return [[`${key}を権限がないためサーバーが拒否する`, { type: '保存失敗' }, {}], ...lost];
	if (idempotent && w.row.applied.includes(key))
		return [[`${key}はもう効いている(成功が届く)`, { type: '保存成功' }, {}], ...lost];
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
		case 'ログインする': {
			// サーバーは DB の本人で答える。異動の前に答えて、届くのが異動のあとのこともある
			const before = users[f.email];
			const now = dbMe(w, before.id);
			return [
				[`${now.name}のログインが通る`, { type: 'ログイン成功', me: now }, {}],
				...(same(before, now)
					? []
					: [
							[
								`${now.name}のログインが異動の前の権限で通る`,
								{ type: 'ログイン成功', me: before },
								{}
							] as [string, Reply, Partial<World>]
						]),
				['ログインが失敗する', { type: 'ログイン失敗', message: '失敗' }, {}]
			];
		}
		case 'ログアウトする':
			return [
				['ログアウトが通る', { type: 'ログアウト完了' }, {}],
				['ログアウトが失敗する', { type: 'ログアウト失敗' }, {}]
			];
		case '保存する': {
			const { key } = f.draft;
			const stored = { ...w.stored, [key]: w.stored[key] ?? content(f.draft) };
			const doubtful = [...new Set([...w.doubtful, key])].sort();
			// 書き込めない人の作成は、同じキーがもう保存されていても 403(RLS の with check が先に効く。測った)
			if (!canWrite(dbMe(w, f.as), f.draft))
				return [
					[`${key}を権限がないためサーバーが拒否する`, { type: '保存失敗' }, {}],
					[`${key}の要求がサーバーに届かない`, { type: '保存結果不明' }, { doubtful }],
					[`${key}の要求の本人がセッションと違う`, { type: '本人が変わった' }, {}]
				];
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
			if (!canRead(dbMe(w, f.as), feature1.ref))
				return [
					['地物を読めない(権限がない)', { type: '読み込めない' }, {}],
					['読み込みの本人がセッションと違う', { type: '本人が変わった' }, {}]
				];
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
			return updateOutcomes(w, f, env.idempotentUpdates);
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
	const me = dbMe(w, f.as);
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
export type Environment = {
	scope: '作成' | '編集' | '検索' | '異動と検索';
	idempotentUpdates: boolean;
	/** 管理者が、ログインしている本人を異動する(P15。1回まで) */
	transfers: boolean;
	/** 変更の流れをつなぐたびに、サーバーが DB の本人を送る(P15) */
	meOnConnect: boolean;
};
export const creating: Environment = {
	scope: '作成',
	idempotentUpdates: true,
	transfers: true,
	meOnConnect: true
};
export const editing: Environment = {
	scope: '編集',
	idempotentUpdates: true,
	transfers: true,
	meOnConnect: true
};
/** 範囲の検索: 地図を動かし、検索の応答が送った順と違う順に届く。ログインし直す前の本人の応答も届く。
    異動は入れない(入れるとメモリに収まらないので、異動と検索の範囲で見る)。 */
export const searching: Environment = {
	scope: '検索',
	idempotentUpdates: true,
	transfers: false,
	meOnConnect: true
};
/** 異動と検索: 検索の範囲に異動を入れる。ほかのタブでのログインし直しは入れず、検索の番号の上限を下げる。 */
export const transferringSearch: Environment = {
	scope: '異動と検索',
	idempotentUpdates: true,
	transfers: true,
	meOnConnect: true
};

// 利用者は、画面に差し出された操作だけを行う(画面はそれ以外の操作を送れない)。
// 環境は、飛んでいる副作用のどれかに、ありうる応答のどれかを返す。受け取れない応答は「応答を捨てた」として記録する。
// 地図ライブラリからの知らせ(タイルの本人違い)は、いつでも届く(検索の範囲では、本人が本当に変わったときだけ)。
// 検索は、サーバーが答える時点と、応答が届く時点を分ける(答えたあとにログインし直すこともある)。
export const stepsWith =
	(m: Machine, env: Environment = creating) =>
	(w: World): Step<World>[] => {
		const tracked = env.scope === '検索' || env.scope === '異動と検索';
		const out: Step<World>[] = [];
		const offered = m.offers(w.app);
		for (const [label, op] of sampleOps(w, env)) {
			const step = perform(offered, op);
			if (!step) continue;
			out.push([
				label,
				{
					...apply(w, step, {}, '操作'),
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
				apply(w, m.notify(w.app, { type: '地図の本人が変わった' }), {}, '知らせ')
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
		if (env.scope === '検索' && w.serverUser !== null && w.otherTabsUsed < maxOtherTabs)
			out.push([
				'ほかのタブで別の人がログインし直す',
				{
					...w,
					serverUser: w.serverUser === users['admin@example.com'].id ? 'u-viewer' : 'u-admin',
					otherTabsUsed: w.otherTabsUsed + 1
				}
			]);
		// 管理者が、ログインしている(またはログインしようとしている)本人を異動する。変更の流れがその本人として
		// 開いていれば、サーバーは権限の知らせを出す(届くのはもっとあと)
		const target =
			session(w.app)?.me ?? (w.app.kind === 'ログイン中' ? users[w.app.email] : undefined);
		if (env.transfers && target && w.transferred === null) {
			const moved = transferOf(target);
			out.push([
				`管理者が${target.name}を異動する`,
				{
					...w,
					transferred: moved,
					changes:
						session(w.app)?.me.id === target.id
							? enqueue(w.changes, { type: '権限が変わった', me: moved })
							: w.changes
				}
			]);
		}
		if (env.scope === '編集' && w.othersUsed < maxOthers)
			out.push([
				'ほかの人が地物を更新する',
				{
					...w,
					row: { ...w.row, version: w.row.version + 1 },
					changes: emitChange(w, 'other', w.row.version + 1),
					othersUsed: w.othersUsed + 1
				}
			]);
		const streaming = session(w.app)?.me.id;
		if (env.scope === '編集' && streaming && w.resumesUsed < maxResumes) {
			const resumed = m.notify(w.app, { type: '変更の流れをつなぎ直した', as: streaming });
			out.push([
				'変更の流れをつなぎ直す',
				{
					...apply(w, resumed, { changes: connected(w, w.changes, w.app, env) }, '知らせ'),
					resumesUsed: w.resumesUsed + 1
				}
			]);
			// 切れていた間の知らせ(届く途中のものも)は、新しい流れには来ない
			out.push([
				'変更の流れが切れ、届く途中の知らせを落としてつなぎ直す',
				{
					...apply(w, resumed, { changes: connected(w, [], w.app, env) }, '知らせ'),
					resumesUsed: w.resumesUsed + 1
				}
			]);
		}
		w.changes.forEach((n, i) => {
			const changes = w.changes.filter((_, j) => j !== i);
			out.push([changeLabel(n), apply(w, m.notify(w.app, n), { changes }, '知らせ')]);
		});
		w.inflight.forEach((f, i) => {
			const inflight = w.inflight.filter((_, j) => j !== i);
			if (f.type === '検索する') {
				for (const [label, reply] of searchAnswers(f, w))
					out.push([label, { ...w, inflight, answered: canonical([...w.answered, reply]) }]);
				return;
			}
			for (const [label, reply, rawServer] of deliveries(f, w, env)) {
				// 更新が効いたら、サーバーはそのキーの変更を知らせる(届くのはもっとあと)
				const appliedKey = rawServer.row?.applied.find((k) => !w.row.applied.includes(k));
				const notified =
					appliedKey && rawServer.row
						? { changes: emitChange(w, appliedKey, rawServer.row.version) }
						: {};
				const server = tracked
					? { ...rawServer, serverUser: serverUserAfter(w, reply) }
					: { ...rawServer, ...notified };
				const step = m.receive(w.app, reply);
				// ログインできたら、変更の流れをその本人としてつなぐ
				const opened =
					step && reply.type === 'ログイン成功'
						? { changes: connected(w, server.changes ?? w.changes, step.state, env) }
						: {};
				out.push([
					label,
					step
						? apply(w, step, { ...server, ...opened, inflight })
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
		const limit = env.scope === '検索' ? maxSearches : maxSearchesWithTransfer;
		return tracked ? out.filter(([, next]) => mapOf(next.app).issued <= limit) : out;
	};

const mapOf = (app: State) => (app.kind === 'ログアウト中' ? app.from.map : app.map);

const maxResumes = 1;

/** 届く途中の知らせに足す。届く順番は決まっていないので、並べ替えておく(同じ状態を2度数えない)。 */
const enqueue = (changes: Notice[], n: Notice) =>
	[...changes, n]
		.map((c) => JSON.stringify(c))
		.sort()
		.map((c) => JSON.parse(c) as Notice);

/** サーバーが変更を知らせる。変更の流れは、ログインしている本人として開いている(いなければ届かない)。 */
function emitChange(w: World, key: string, version: number): Notice[] {
	const me = session(w.app)?.me.id;
	if (!me) return w.changes;
	return enqueue(w.changes, { type: '地物が変わった', change: { id: 1, version, key, as: me } });
}

/** 変更の流れを(つなぎ直して)開いた。`meOnConnect` なら、サーバーは最初に DB の本人を送る。
    画面の本人と同じなら知らせても何も変わらないので、違うときだけ足す。 */
function connected(w: World, changes: Notice[], app: State, env: Environment): Notice[] {
	const s = session(app);
	if (!env.meOnConnect || !s) return changes;
	const now = dbMe(w, s.me.id);
	return same(now, s.me) ? changes : enqueue(changes, { type: '権限が変わった', me: now });
}

const changeLabel = (n: Notice) =>
	n.type === '地物が変わった'
		? `変更の知らせ(${n.change.key}、版${n.change.version})が届く`
		: n.type === '権限が変わった'
			? `権限の知らせ(${n.me.name}、${n.me.role}${n.me.canEdit ? '' : '、編集不可'})が届く`
			: n.type;

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
export const transferSearchSteps = stepsWith(machine, transferringSearch);

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

// P15(2026-11-22 に「編集できない人は描けない。市職員は自分の市にしか描けない」から言い直した。
// 描いている間に権限が変わりうるので、下書きではなく送るときの権限で見る):
// 保存・更新を送るのは、送るときの DB の権限で許されているときだけ(権限の知らせが届く途中か、結果不明の送り直しを除く)
export const p15Sent = (w: World) => !w.broken.includes('P15');

// P15 橋: 本人あての権限の知らせが届く途中でなければ、画面の本人は DB の本人と同じ。
// Lean の P15 の定理は画面の本人について述べる。DB の本人とつなぐのが、この性質(証明の外)
export const p15Current = (w: World) => {
	const s = session(w.app);
	return !s || permissionPending(w, s.me.id) || same(s.me, dbMe(w, s.me.id));
};

// P15: 権限の知らせが届く途中でなければ、選んでいる地物と一覧の地物は、DB の権限で読めるもの
export const p15Readable = (w: World) => {
	const s = session(w.app);
	if (!s || permissionPending(w, s.me.id)) return true;
	const me = dbMe(w, s.me.id);
	const selected = s.screen.kind === '閲覧' ? s.screen.selected : null;
	const l = s.search.shown;
	return (
		(!selected || canRead(me, selected.ref)) &&
		(l?.kind !== '見つかった' || l.hits.every((h) => canRead(me, h.ref)))
	);
};

// 失敗の表示が正直: 失敗と表示したとき、その要求はサーバーで効いていない
export const honestFailure = (w: World) =>
	!w.broken.includes('更新の失敗の表示') && !w.broken.includes('保存の失敗の表示');

// P12: 結果が分からなくなった更新は、同じキー・同じ中身でしか送り直さない
export const p12 = (w: World) => !w.broken.includes('P12');

// 応答待ち(保存中・読込中・更新中)なら、その副作用がまだ飛んでいる(届けば応答待ちを抜ける)
export const busyAwaits = (w: World) => {
	const v = session(w.app)?.screen;
	return !v || !busy(v) || w.inflight.some((f) => f.type !== 'ログアウトする');
};

// 競合の表示が正直: 競合と表示したとき、その更新はサーバーで効いていない(P12)
export const honestConflict = (w: World) => !w.broken.includes('競合の表示');

// P14 警告が正直: 「ほかの人が更新した」と出したとき、サーバーの版は編集を始めたときより新しい
export const honestWarning = (w: World) => !w.broken.includes('警告の表示');

// 更新の成功の表示が正直: 成功と表示したとき(応答でも、変更の知らせでも)、その更新はサーバーで効いている
export const honestUpdate = (w: World) => !w.broken.includes('更新の成功の表示');

// P13: 一覧に出している地物は、今の本人が読めるものだけ(前の本人への検索の応答を出さない)。
// 2026-11-22 言い直し: 権限は変わりうるので、「今の本人」は画面の本人か DB の本人のどちらか
// (知らせが届くまでの間は、どちらの権限での応答も届く。届いたあとは P15 で DB の本人に絞る)
export const p13Readable = (w: World) => {
	const s = session(w.app);
	const l = s?.search.shown;
	if (!s || l?.kind !== '見つかった') return true;
	const now = dbMe(w, s.me.id);
	return l.hits.every((h) => canRead(s.me, h.ref) || canRead(now, h.ref));
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

/** P15 の性質が空振りしていないことを確かめるための、探索が届いた場面。 */
export function p15Scenes(w: World): string[] {
	const seen: string[] = [];
	const s = session(w.app);
	if (w.transferred) seen.push('異動した');
	if (!s) return seen;
	const pending = permissionPending(w, s.me.id);
	const now = dbMe(w, s.me.id);
	const v = s.screen;
	if (!same(s.me, now)) seen.push('画面の権限が DB と違う(知らせが届く途中)');
	if (pending && busy(v)) seen.push('応答待ちの間に権限の知らせが届く途中');
	if (pending && w.app.kind === 'ログアウト中') seen.push('ログアウト中に権限の知らせが届く途中');
	if (pending && v.kind === '閲覧' && v.selected && !canRead(now, v.selected.ref))
		seen.push('選んでいる地物を読めなくなる知らせが届く途中');
	if (pending && s.search.shown) seen.push('一覧を出している間に権限の知らせが届く途中');
	if (
		w.answered.some(
			(r) =>
				r.type === '検索の応答' &&
				r.result.type === '見つかった' &&
				r.result.hits.some((h) => !canRead(now, h.ref))
		)
	)
		seen.push('異動の前の権限で答えた検索の応答が届く途中');
	if (v.kind === '描画中' && v.draft.points.length >= 3 && !canWrite(s.me, v.draft))
		seen.push('権限が変わって、描いている下書きを保存できない');
	if (v.kind === '編集中' && !canWrite(s.me, v.edit.ref))
		seen.push('権限が変わって、編集している地物を保存できない');
	if (v.kind === '更新結果不明' && v.notice === '再送失敗' && w.row.applied.includes(v.key))
		seen.push('効いた更新の送り直しが、権限がないため拒否されて結果不明');
	return seen;
}
