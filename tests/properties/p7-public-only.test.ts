import fc from 'fast-check';
import { expect, test } from 'vitest';
import { exits, loadSeed } from './harness.ts';
import { bboxIn, privateLeaks } from './rules.ts';

for (const exit of exits) {
	test(`P7 公開範囲(${exit.name}): 閲覧者は、どの出口からも非公開の地物を受け取らない`, async () => {
		const seed = await loadSeed();
		await fc.assert(
			fc.asyncProperty(bboxIn(seed.extent), async (area) => {
				expect(privateLeaks('viewer', await exit.fetch('viewer', area), seed)).toEqual([]);
			})
		);
	});
}
