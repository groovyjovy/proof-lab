export type Step<S> = [label: string, next: S];

export type Result = { ok: true; states: number } | { ok: false; trace: string[]; states: number };

// 全状態を幅優先で探索し、不変条件を確かめる。反例があれば手順を返す。
// 状態は JSON の文字列で見分ける。どこから来たかは、文字列ではなく探索の順番(番号)で持つ(メモリを抑える)。
export function check<S>(
	init: S,
	steps: (s: S) => Step<S>[],
	invariant: (s: S) => boolean
): Result {
	const seen = new Set<string>([JSON.stringify(init)]);
	const queue: S[] = [init];
	const from: { prev: number; label: string }[] = [{ prev: -1, label: '初期状態' }];
	for (let head = 0; head < queue.length; head++) {
		const s = queue[head];
		if (!invariant(s)) {
			const trace: string[] = [];
			for (let i = head; i >= 0; i = from[i].prev) trace.unshift(from[i].label);
			return { ok: false, trace, states: seen.size };
		}
		for (const [label, t] of steps(s)) {
			const k = JSON.stringify(t);
			if (!seen.has(k)) {
				seen.add(k);
				from.push({ prev: head, label });
				queue.push(t);
			}
		}
	}
	return { ok: true, states: seen.size };
}

export type Exploration = {
	states: number;
	/** 破れた性質と、最短の反例の手順 */
	failed: Record<string, string[]>;
	/** 探索が届いた場面(`observe` が返した名前) */
	seen: Set<string>;
};

// 全状態を幅優先で1回だけ探索し、すべての性質と、探索が届いた場面をまとめて見る(大きい範囲で、性質ごとに
// 探索し直さないため)。性質が破れても探索は続け、性質ごとに最短の反例を残す。
export function explore<S>(
	init: S,
	steps: (s: S) => Step<S>[],
	properties: Record<string, (s: S) => boolean>,
	observe: (s: S) => Iterable<string> = () => []
): Exploration {
	const seen = new Set<string>([JSON.stringify(init)]);
	const queue: S[] = [init];
	const from: { prev: number; label: string }[] = [{ prev: -1, label: '初期状態' }];
	const failed: Record<string, string[]> = {};
	const scenes = new Set<string>();
	for (let head = 0; head < queue.length; head++) {
		const s = queue[head];
		for (const [name, property] of Object.entries(properties)) {
			if (name in failed || property(s)) continue;
			const trace: string[] = [];
			for (let i = head; i >= 0; i = from[i].prev) trace.unshift(from[i].label);
			failed[name] = trace;
		}
		for (const scene of observe(s)) scenes.add(scene);
		for (const [label, t] of steps(s)) {
			const k = JSON.stringify(t);
			if (!seen.has(k)) {
				seen.add(k);
				from.push({ prev: head, label });
				queue.push(t);
			}
		}
		queue[head] = undefined as S;
	}
	return { states: seen.size, failed, seen: scenes };
}
