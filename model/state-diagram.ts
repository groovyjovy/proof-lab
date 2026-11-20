// 画面の状態図を、モデル3が全探索でたどった遷移から作る(手で描くと実装とずれる)。
import { next, type Event } from '#lib/app/machine.ts';
import { check } from './check.ts';
import * as m3 from './model3-app.ts';

export function stateDiagram() {
	const kinds = [m3.kindOf(m3.init.app)];
	const edges = new Map<string, Set<Event['type']>>();
	const recording: m3.Machine = (s, e) => {
		const step = next(s, e);
		const [from, to] = [m3.kindOf(s), m3.kindOf(step.state)];
		if (from !== to) {
			if (!kinds.includes(to)) kinds.push(to);
			const edge = `${kinds.indexOf(from)}\t${kinds.indexOf(to)}`;
			edges.set(edge, (edges.get(edge) ?? new Set()).add(e.type));
		}
		return step;
	};
	check(m3.init, m3.stepsWith(recording), () => true);

	const mermaid = [
		'stateDiagram-v2',
		'    [*] --> s0',
		...kinds.map((k, i) => `    state "${k}" as s${i}`),
		...[...edges]
			.map(([edge, events]) => {
				const [from, to] = edge.split('\t').map(Number);
				return { from, to, events: [...events].join(' / ') };
			})
			.sort((a, b) => a.from - b.from || a.to - b.to)
			.map(({ from, to, events }) => `    s${from} --> s${to}: ${events}`)
	].join('\n');
	return { kinds, mermaid };
}
