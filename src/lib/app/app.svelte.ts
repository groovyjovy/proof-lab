import { onMount } from 'svelte';
import type { Me } from '#lib/domain.ts';
import { run } from './effects.ts';
import {
	init,
	notify,
	offers,
	receive,
	type Notice,
	type Offers,
	type Op,
	type OpOf,
	type Step
} from './machine.ts';

type Payload<T extends Op['type']> = Omit<OpOf<T>, 'type'>;
export type Actions = {
	[T in Op['type']]?: keyof Payload<T> extends never ? () => void : (payload: Payload<T>) => void;
};

export function createApp(me: Me | null) {
	let state = $state.raw(init(me));
	// サーバーが描いた HTML では、ハイドレーションが終わるまで押しても何も起きない。
	// その間は操作を差し出さない(ボタンは押せない)。onMount はブラウザで画面がつながってから走る。
	let interactive = $state(false);
	onMount(() => {
		interactive = true;
	});

	function apply(step: Step) {
		state = step.state;
		for (const effect of step.effects)
			run(effect).then((reply) => {
				const next = receive(state, reply);
				if (!next) throw new Error(`応答「${reply.type}」を「${state.kind}」で受け取れなかった`);
				apply(next);
			});
	}

	const actions = $derived(interactive ? bind(offers(state), apply) : {});

	return {
		get state() {
			return state;
		},
		get actions() {
			return actions;
		},
		notify: (n: Notice) => apply(notify(state, n))
	};
}

function bind(offered: Offers, apply: (step: Step) => void): Actions {
	return Object.fromEntries(
		Object.entries(offered)
			.filter(([, transition]) => transition)
			.map(([type, transition]) => [
				type,
				(payload = {}) => apply((transition as (op: Op) => Step)({ type, ...payload } as Op))
			])
	);
}
