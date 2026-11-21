import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { applyEdit, insertFeature, login, updateRecord } from './harness.ts';

test('P12 更新の冪等性: 同じキーの更新は、何度送っても(同時に送っても)1回しか効かず、どれも成功を返す。版が古くても、もう効いたキーなら成功', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 3 }),
			async (waves) => {
				const id = await insertFeature('A', true);
				const session = await login('a-staff');
				const loaded = await session.load(id);
				const key = randomUUID();
				for (const n of waves) {
					const results = await Promise.all(
						Array.from({ length: n }, () => session.save(id, applyEdit(loaded, 'a-staff'), key))
					);
					expect(results).toEqual(results.map(() => ({ ok: true })));
				}
				expect(await updateRecord(id)).toEqual({ version: 1, keys: 1 });
			}
		),
		{ numRuns: 15 }
	);
});

test('P4 と P12: 同じ版を読んだ二人が別のキーで同時に更新すると、効くのは1つだけで、残りは競合になる', async () => {
	const id = await insertFeature('A', true);
	const [a, admin] = [await login('a-staff'), await login('admin')];
	const loaded = await a.load(id);
	const results = await Promise.all([
		a.save(id, applyEdit(loaded, 'a-staff')),
		admin.save(id, applyEdit(loaded, 'admin')),
		a.save(id, applyEdit(loaded, 'a-staff-2'))
	]);
	expect(results.filter((r) => r.ok)).toHaveLength(1);
	expect(await updateRecord(id)).toEqual({ version: 1, keys: 1 });
});
