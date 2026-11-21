import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { generatedPart, migration, policySql } from '../../scripts/spec-sql.ts';

test('認可の SQL 関数は、Lean の仕様から書き出したものと同じ(ずれていたら pnpm spec:sql で書き直す)', async () => {
	expect(generatedPart(await readFile(migration, 'utf8'))).toBe(await policySql());
});
