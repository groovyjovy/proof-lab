import { expect, test } from 'vitest';
import { exits, loadSeed, roles, type City, type Role, type Seed } from './harness.ts';

const ownCity: Partial<Record<Role, City>> = { 'a-staff': 'A', 'b-staff': 'B' };

const shouldSee = (role: Role, seed: Seed, ids: string[]) =>
	ids.filter((id) =>
		role === 'admin'
			? true
			: role === 'viewer'
				? seed.isPublic(id)
				: seed.cityOf(id) === ownCity[role]
	);

for (const exit of exits)
	test(`対照(${exit.name}): 全範囲を取ると、各ロールに見えるべき地物がちょうど届く(性質テストが空振りしていないことの確認)`, async () => {
		const seed = await loadSeed();
		const all = [...seed.featuresIn('A'), ...seed.featuresIn('B')];
		for (const role of roles) {
			const received = new Set((await exit.fetch(role, seed.extent)).map((f) => f.id));
			expect([...received].sort()).toEqual(shouldSee(role, seed, all).sort());
		}
	});
