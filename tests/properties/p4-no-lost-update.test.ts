import { expect, test } from 'vitest';
import { applyEdit, hasEdit, loadSeed, login, type Session } from './harness.ts';

type Who = 'a' | 'b';

const interleavings = (a: number, b: number): Who[][] =>
	a === 0
		? [Array<Who>(b).fill('b')]
		: b === 0
			? [Array<Who>(a).fill('a')]
			: [
					...interleavings(a - 1, b).map((rest): Who[] => ['a', ...rest]),
					...interleavings(a, b - 1).map((rest): Who[] => ['b', ...rest])
				];

async function* client(session: Session, featureId: string, editor: string) {
	const loaded = await session.load(featureId);
	yield;
	const edited = applyEdit(loaded, editor);
	yield;
	return (await session.save(featureId, edited)).ok;
}

test.each(interleavings(3, 3).map((order) => order.join('')))(
	'P4 ロストアップデートなし: 二人とも保存を完了したら、両者の編集が残っている(読込・編集・保存の順序 %s)',
	async (order) => {
		const seed = await loadSeed();
		const [featureId] = seed.featuresIn('A');
		const editors = { a: `a-staff:${order}`, b: `admin:${order}` };
		const runs = {
			a: client(await login('a-staff'), featureId, editors.a),
			b: client(await login('admin'), featureId, editors.b)
		};
		const saved = { a: false, b: false };
		for (const who of order as Iterable<Who>) {
			const step = await runs[who].next();
			if (step.done) saved[who] = step.value;
		}
		const final = await (await login('admin')).load(featureId);
		expect(!(saved.a && saved.b) || (hasEdit(final, editors.a) && hasEdit(final, editors.b))).toBe(
			true
		);
	}
);
