import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { stateDiagram } from './state-diagram.ts';

test('docs/screens.md の状態図は、モデル3の全探索から作った図と同じ', async () => {
	expect(await readFile('docs/screens.md', 'utf8')).toContain(
		['```mermaid', stateDiagram().mermaid, '```'].join('\n')
	);
}, 30_000);
