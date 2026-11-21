// モデル3: 実装の状態機械(src/lib/app/machine.ts の offers と receive)をそのまま、通信とサーバーの環境と一緒に検査する。
// 書き直したモデルではないので、ここで出た反例は実装の反例。範囲を区切った全探索で、範囲なしの証明は spec/ にある。
import type { Me } from '#lib/domain.ts';
import {
	notify,
	offers,
	perform,
	receive,
	busy,
	saving,
	type Draft,
	type Effect,
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

export const init: World = {
	app: { kind: '未ログイン', error: null },
	inflight: [],
	stored: {},
	sent: {},
	doubtful: [],
	keysUsed: 0,
	loginsUsed: 0,
	row: { version: 0, applied: [] },
	updatesUsed: 0,
	othersUsed: 0,
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
	return ops.filter(([, op]) =>
		env.scope === '作成' ? !editing.includes(op.type) : op.type !== '描画開始'
	);
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
	}
}

/**
 * 検査の範囲とサーバーの性質。作成(描画と保存)と編集は独立した流れなので、別々に全探索する
 * (1つの世界に入れると、サーバーの状態が掛け算で増えて、メモリに収まらない)。
 * 既定のサーバーは実装のとおり(更新はキーで冪等)。
 */
export type Environment = { scope: '作成' | '編集'; idempotentUpdates: boolean };
export const creating: Environment = { scope: '作成', idempotentUpdates: true };
export const editing: Environment = { scope: '編集', idempotentUpdates: true };

// 利用者は、画面に差し出された操作だけを行う(画面はそれ以外の操作を送れない)。
// 環境は、飛んでいる副作用のどれかに、ありうる応答のどれかを返す。受け取れない応答は「応答を捨てた」として記録する。
// 地図ライブラリからの知らせ(タイルの本人違い)は、いつでも届く。
export const stepsWith =
	(m: Machine, env: Environment = creating) =>
	(w: World): Step<World>[] => {
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
		out.push(['地図の本人が変わった', apply(w, m.notify(w.app, { type: '地図の本人が変わった' }))]);
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
			for (const [label, reply, server] of deliveries(f, w, env)) {
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
		return out;
	};

export const steps = stepsWith(machine);
export const editSteps = stepsWith(machine, editing);

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

export const kindOf = (app: State) => {
	const s = session(app);
	return s ? `${app.kind}/${s.screen.kind}` : app.kind;
};
