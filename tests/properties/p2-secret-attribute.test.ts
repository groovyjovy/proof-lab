import fc from 'fast-check';
import { expect, test } from 'vitest';
import { exits, loadSeed } from './harness.ts';
import { bboxIn, secretLeaks } from './rules.ts';

for (const exit of exits) {
	test(`P2 属性秘匿(${exit.name}): 閲覧者には、どの出口からも owner_name が届かない`, async () => {
		const seed = await loadSeed();
		await fc.assert(
			fc.asyncProperty(bboxIn(seed.extent), async (area) => {
				expect(secretLeaks('viewer', await exit.fetch('viewer', area))).toEqual([]);
			})
		);
	});
}
