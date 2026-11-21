import fc from 'fast-check';
import { expect, test } from 'vitest';
import { exits, loadSeed, type Role } from './harness.ts';
import { bboxIn, unreadable } from './rules.ts';

for (const exit of exits) {
	test(`P1 地域分離(${exit.name}): 市職員がどの出口から受け取る地物も、仕様が読めるとするもの(担当の市の地物)だけ`, async () => {
		const seed = await loadSeed();
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom<Role>('a-staff', 'b-staff'),
				bboxIn(seed.extent),
				async (role, area) => {
					expect(unreadable(role, await exit.fetch(role, area), seed)).toEqual([]);
				}
			)
		);
	});
}
