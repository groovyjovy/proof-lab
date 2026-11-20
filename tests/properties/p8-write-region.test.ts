import fc from 'fast-check';
import { expect, test } from 'vitest';
import { loadSeed, login, roles, type City } from './harness.ts';
import { canWrite } from './rules.ts';

const cities: City[] = ['A', 'B'];

test('P8 書き込みの地域分離(作成): 市職員は他市の地物を作成できず、閲覧者は何も作成できない', async () => {
	await fc.assert(
		fc.asyncProperty(fc.constantFrom(...roles), fc.constantFrom(...cities), async (role, city) => {
			expect(await (await login(role)).create(city)).toEqual({ ok: canWrite(role, city) });
		})
	);
});

test('P8 書き込みの地域分離(編集): 市職員は他市の地物を編集できず、自分の市の地物を他市へ移すこともできない。閲覧者は何も編集できない', async () => {
	const seed = await loadSeed();
	const admin = await login('admin');
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...roles),
			fc.constantFrom(...seed.featuresIn('A'), ...seed.featuresIn('B')),
			fc.constantFrom(...cities),
			async (role, featureId, to) => {
				const current = await admin.load(featureId);
				const result = await (await login(role)).save(featureId, { ...current, city: to });
				expect(result).toEqual({ ok: canWrite(role, current.city) && canWrite(role, to) });
			}
		)
	);
});
