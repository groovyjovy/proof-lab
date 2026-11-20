import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { countFeaturesWithKey, login, roles, type City } from './harness.ts';
import { canWrite } from './rules.ts';

const writers = roles.filter((r) => r !== 'viewer');
const cities: City[] = ['A', 'B'];

test('P10 タイムアウトのあとに保存し直しても、地物は1つしかできない: 同じキーで何度送っても(同時に送っても)1つ', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...writers),
			fc.constantFrom(...cities),
			fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 2, maxLength: 3 }),
			async (role, city, waves) => {
				fc.pre(canWrite(role, city));
				const session = await login(role);
				const key = randomUUID();
				for (const n of waves) {
					const results = await Promise.all(
						Array.from({ length: n }, () => session.create(city, key))
					);
					expect(results).toEqual(results.map(() => ({ ok: true })));
				}
				expect(await countFeaturesWithKey(key)).toBe(1);
			}
		)
	);
});

test('P10 と P8: 他人のキーで送っても、書けない人には成功にならず、地物も増えない', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...writers),
			fc.constantFrom(...cities),
			fc.constantFrom(...roles),
			async (owner, city, other) => {
				fc.pre(canWrite(owner, city) && !canWrite(other, city));
				const key = randomUUID();
				expect(await (await login(owner)).create(city, key)).toEqual({ ok: true });
				expect(await (await login(other)).create(city, key)).toEqual({ ok: false });
				expect(await countFeaturesWithKey(key)).toBe(1);
			}
		)
	);
});
