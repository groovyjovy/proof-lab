import {
	notify,
	offers,
	perform,
	receive,
	type Effect,
	type Notice,
	type Op,
	type Reply,
	type State,
	type Step
} from '#lib/app/machine.ts';

// 実装の状態機械に操作・応答・知らせを当てて、Lean の窓口(spec/Main.lean)と同じ形の結果にする。

export type Event = { op: Op } | { reply: Reply } | { notice: Notice };
export type Snapshot = { state: State; effects: Effect[]; offers: string[] };

const offered = (s: State) =>
	Object.entries(offers(s))
		.filter(([, transition]) => transition)
		.map(([type]) => type);

export const applyEvent = (s: State, e: Event): Step | undefined =>
	'op' in e ? perform(offers(s), e.op) : 'reply' in e ? receive(s, e.reply) : notify(s, e.notice);

export const snapshot = (state: State, effects: Effect[]): Snapshot => ({
	state,
	effects,
	offers: offered(state)
});

/** JSON にしてから戻し(Lean の答えと同じ形にする)、差し出す操作の順番をそろえる。 */
export const normalize = <T>(value: T): T =>
	JSON.parse(JSON.stringify(value), (key, v) => (key === 'offers' ? [...v].sort() : v));
