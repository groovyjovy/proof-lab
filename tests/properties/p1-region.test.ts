import fc from 'fast-check';
import { expect, test } from 'vitest';
import { exits, loadSeed, type Role } from './harness.ts';
import { bboxIn, regionLeaks } from './rules.ts';

for (const exit of exits) {
	test(`P1 地域分離(${exit.name}): 市職員は、どの出口からも他市の地物を受け取らない`, async () => {
		const seed = await loadSeed();
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom<Role>('a-staff', 'b-staff'),
				bboxIn(seed.extent),
				async (role, area) => {
					expect(regionLeaks(role, await exit.fetch(role, area), seed)).toEqual([]);
				}
			)
		);
	});
}
