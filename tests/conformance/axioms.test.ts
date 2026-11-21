import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// Lean の標準の公理。これ以外(書きかけの証明の sorryAx、native_decide の Lean.ofReduceBool、
// 自分で足した axiom など)に依存する定理は、Lean のカーネルだけで確かめた証明ではない
const standard = new Set(['propext', 'Quot.sound', 'Classical.choice']);

function printedAxioms() {
	const out = execFileSync('lake', ['env', 'lean', 'Axioms.lean'], {
		cwd: 'spec',
		encoding: 'utf8'
	});
	return new Map(
		out
			.trim()
			.split('\n')
			.map((line): [string, string[]] => {
				const m = /^'([^']+)' (?:depends on axioms: \[(.*)\]|does not depend on any axioms)$/.exec(
					line
				);
				if (!m) throw new Error(`#print axioms の出力を読めない: ${line}`);
				return [m[1], m[2] ? m[2].split(', ') : []];
			})
	);
}

/** docs/proofs.md の定理の表に書いた定理の名前 */
function documented() {
	const names = readFileSync('docs/proofs.md', 'utf8')
		.split('\n')
		.filter((line) => line.startsWith('| `'))
		.flatMap((line) => [...line.split('|')[1].matchAll(/`([\w.]+)`/g)].map((m) => m[1]));
	return new Set(names);
}

test('性質を表す定理は、どれも Lean の標準の公理だけに依存する(sorry や native_decide を使っていない)', () => {
	const axioms = printedAxioms();
	expect(axioms.size).toBe(38);
	for (const [name, used] of axioms)
		expect(
			used.filter((a) => !standard.has(a)),
			name
		).toEqual([]);
});

test('公理を確かめる定理(spec/Axioms.lean)は、docs/proofs.md の表に書いた定理と同じ', () => {
	const checked = [...printedAxioms().keys()].map((name) => name.split('.').pop()).sort();
	expect(checked).toEqual([...documented()].sort());
});
