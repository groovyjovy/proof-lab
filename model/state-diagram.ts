// 画面の状態図を、モデル3が全探索でたどった遷移から作る(手で描くと実装とずれる)。
import { offers, receive, type Offers, type Op, type Step } from '#lib/app/machine.ts';
import { check } from './check.ts';
import * as m3 from './model3-app.ts';

export function stateDiagram() {
	const kinds = [m3.kindOf(m3.init.app)];
	const edges = new Map<string, Set<string>>();
	const record = (from: string, label: string, step: Step) => {
		const to = m3.kindOf(step.state);
		if (from === to) return step;
		if (!kinds.includes(to)) kinds.push(to);
		const edge = `${kinds.indexOf(from)}\t${kinds.indexOf(to)}`;
		edges.set(edge, (edges.get(edge) ?? new Set()).add(label));
		return step;
	};
	const recording: m3.Machine = {
		offers: (s) =>
			Object.fromEntries(
				Object.entries(offers(s)).map(([type, transition]) => [
					type,
					transition &&
						((op: Op) => record(m3.kindOf(s), type, (transition as (op: Op) => Step)(op)))
				])
			) as Offers,
		receive: (s, r) => {
			const step = receive(s, r);
			return step && record(m3.kindOf(s), r.type, step);
		}
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
