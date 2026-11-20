// モデル3: 実装の状態機械(src/lib/app/machine.ts の next)をそのまま、通信とサーバーの環境と一緒に検査する。
// 書き直したモデルではないので、ここで出た反例は実装の反例。
import type { Me } from '#lib/server/authz/index.ts';
import {
	next,
	type Draft,
	type Effect,
	type Event,
	type LoggedIn,
	type Point,
	type State,
	saving
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
	broken: string[];
};

const users: Record<string, Me> = {
	'admin@example.com': { name: '管理者', role: 'admin', canEdit: true },
	'a-staff@example.com': { name: 'A市職員', role: 'a-staff', canEdit: true },
	'b-staff@example.com': { name: 'B市職員', role: 'b-staff', canEdit: true },
	'viewer@example.com': { name: '閲覧者', role: 'viewer', canEdit: false }
};
const points: Record<string, Point> = { p1: [0, 0] };
const maxKeys = 2;
const maxLogins = 2;
const maxPoints = 4;

export const init: World = {
	app: { kind: '未ログイン', error: null },
	inflight: [],
	stored: {},
	sent: {},
	doubtful: [],
	keysUsed: 0,
	loginsUsed: 0,
	broken: []
};

export const session = (app: State): LoggedIn | null =>
	app.kind === 'ログイン済み' ? app : app.kind === 'ログアウト中' ? app.from : null;

const content = (d: Draft) => JSON.stringify([d.city, d.public, d.points]);
const savingKey = (app: State) => {
	const v = session(app)?.screen;
	return v && saving(v) ? v.draft.key : null;
};

export type Machine = typeof next;

function apply(machine: Machine, w: World, e: Event, server: Partial<World> = {}): World {
	const { state, effects } = machine(w.app, e);
	const broken = new Set(w.broken);
	const sent = { ...w.sent };
	const doubtful = server.doubtful ?? w.doubtful;
	for (const f of effects) {
		if (f.type !== '保存する') continue;
		if (doubtful.includes(f.draft.key) && sent[f.draft.key] !== content(f.draft)) broken.add('P10');
		sent[f.draft.key] = content(f.draft);
	}
	const stored = server.stored ?? w.stored;
	const before = session(w.app)?.screen;
	const after = session(state);
	if (
		before &&
		saving(before) &&
		after?.screen.kind === '閲覧' &&
		after.tiles > session(w.app)!.tiles
	)
		if (stored[before.draft.key] !== content(before.draft)) broken.add('成功の表示');
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

function userEvents(w: World): [string, Event][] {
	const v = session(w.app)?.screen;
	const full = v !== undefined && v.kind !== '閲覧' && v.draft.points.length >= maxPoints;
	return [
		...(w.loginsUsed < maxLogins
			? Object.keys(users).map((email): [string, Event] => [
					`${users[email].name}でログインを押す`,
					{ type: 'ログインを押す', email }
				])
			: []),
		['ログアウトを押す', { type: 'ログアウトを押す' }],
		...(full
			? []
			: Object.entries(points).flatMap(([name, at]): [string, Event][] => [
					[`地図の${name}をクリック`, { type: '地図をクリック', at, feature: null }],
					[`${name}の地物をクリック`, { type: '地図をクリック', at, feature: { name } }]
				])),
		['ポップアップを閉じる', { type: 'ポップアップを閉じる' }],
		...(w.keysUsed < maxKeys
			? [
					[`描画開始(k${w.keysUsed + 1})`, { type: '描画開始', key: `k${w.keysUsed + 1}` }] as [
						string,
						Event
					]
				]
			: []),
		['A市を選ぶ', { type: '市を選ぶ', city: 'A' }],
		['B市を選ぶ', { type: '市を選ぶ', city: 'B' }],
		['公開にする', { type: '公開を選ぶ', public: true }],
		['確定', { type: '確定' }],
		['取消', { type: '取消' }],
		['再送', { type: '再送' }]
	];
}

function deliveries(f: Effect, w: World): [string, Event, Partial<World>][] {
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
				[`${key}の要求がサーバーに届かない`, { type: '保存結果不明' }, { doubtful }]
			];
		}
	}
}

export const stepsWith =
	(machine: Machine) =>
	(w: World): Step<World>[] => {
		const out: Step<World>[] = [];
		for (const [label, e] of userEvents(w)) {
			const t = apply(machine, w, e);
			if (t.app === w.app) continue;
			out.push([
				label,
				{
					...t,
					keysUsed: w.keysUsed + (e.type === '描画開始' ? 1 : 0),
					loginsUsed: w.loginsUsed + (e.type === 'ログインを押す' ? 1 : 0)
				}
			]);
		}
		w.inflight.forEach((f, i) => {
			const inflight = w.inflight.filter((_, j) => j !== i);
			for (const [label, e, server] of deliveries(f, w))
				out.push([label, apply(machine, w, e, { ...server, inflight })]);
		});
		return out;
	};

export const steps = stepsWith(next);

// L1: 保存中(ログアウト中に隠れている場合も含む)なら、その保存の結果がまだ届いていない
export const l1 = (w: World) => {
	const key = savingKey(w.app);
	return key === null || w.inflight.some((f) => f.type === '保存する' && f.draft.key === key);
};

// 飛んでいる保存は高々1つ(だから保存の結果に、どの保存の結果かを書かなくてよい)
export const singleFlight = (w: World) =>
	w.inflight.filter((f) => f.type === '保存する').length <= 1;

// P6: 保存中は、描画開始を押しても新しい描画が始まらない
export const p6 = (w: World) =>
	savingKey(w.app) === null ||
	savingKey(next(w.app, { type: '描画開始', key: 'new' }).state) === savingKey(w.app);

// P10: 結果が分からなくなった保存は、同じキー・同じ中身でしか送り直さない(サーバーは同じキーを1つしか保存しないので、二重にならない)
export const p10 = (w: World) => !w.broken.includes('P10');

// 保存できたと表示したら、表示していた図形がそのままサーバーにある
export const honestSuccess = (w: World) => !w.broken.includes('成功の表示');

// 編集できない人は描けない。市職員は自分の市にしか描けない
export const drawPermission = (w: World) => {
	const s = session(w.app);
	if (!s || s.screen.kind === '閲覧') return true;
	if (!s.me.canEdit) return false;
	const home = { 'a-staff': 'A', 'b-staff': 'B' }[s.me.role ?? ''];
	return home === undefined || s.screen.draft.city === home;
};

export const kindOf = (app: State) => {
	const s = session(app);
	return s ? `${app.kind}/${s.screen.kind}` : app.kind;
};
