export type Step<S> = [label: string, next: S];

export type Result =
  | { ok: true; states: number }
  | { ok: false; trace: string[]; states: number };

// 全状態を幅優先で探索し、不変条件を確かめる。反例があれば手順を返す。
export function check<S>(init: S, steps: (s: S) => Step<S>[], invariant: (s: S) => boolean): Result {
  const key = (s: S) => JSON.stringify(s);
  const seen = new Map<string, { prev: string; label: string } | null>([[key(init), null]]);
  const queue: S[] = [init];
  while (queue.length) {
    const s = queue.shift()!;
    if (!invariant(s)) {
      const trace: string[] = [];
      let k: string | undefined = key(s);
      while (k) {
        const p = seen.get(k);
        trace.unshift(p ? p.label : "初期状態");
        k = p?.prev;
      }
      return { ok: false, trace, states: seen.size };
    }
    for (const [label, t] of steps(s)) {
      const k = key(t);
      if (!seen.has(k)) {
        seen.set(k, { prev: key(s), label });
        queue.push(t);
      }
    }
  }
  return { ok: true, states: seen.size };
}
