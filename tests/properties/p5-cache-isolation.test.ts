import fc from 'fast-check';
import { expect, test } from 'vitest';
import { exits, loadSeed, roles } from './harness.ts';
import { bboxIn, privateLeaks, regionLeaks, secretLeaks } from './rules.ts';

for (const exit of exits) {
	test(`P5 キャッシュ分離(${exit.name}): 同じ範囲を別の権限のユーザーが続けて取っても、他人向けの結果が届かない`, async () => {
		const seed = await loadSeed();
		await fc.assert(
			fc.asyncProperty(
				bboxIn(seed.extent),
				fc.array(fc.constantFrom(...roles), { minLength: 2, maxLength: 8 }),
				async (area, requesters) => {
					for (const role of requesters) {
						const received = await exit.fetch(role, area);
						expect(regionLeaks(role, received, seed)).toEqual([]);
						expect(secretLeaks(role, received)).toEqual([]);
						expect(privateLeaks(role, received, seed)).toEqual([]);
					}
				}
			)
		);
	});
}
