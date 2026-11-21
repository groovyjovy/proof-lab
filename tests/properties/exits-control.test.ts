import { expect, test } from 'vitest';
import { exits, loadSeed, roles } from './harness.ts';
import { canRead, ownerMismatch } from './rules.ts';

for (const exit of exits)
	test(`仕様との突き合わせ(${exit.name}): 全範囲を取ると、仕様が読めるとする地物がちょうど届き、owner_name の出し方も仕様どおり(性質テストが空振りしていないことの確認も兼ねる)`, async () => {
		const seed = await loadSeed();
		const all = [...seed.featuresIn('A'), ...seed.featuresIn('B')];
		for (const role of roles) {
			const received = await exit.fetch(role, seed.extent);
			// 境目をまたぐ地物は、どのタイルにも入って届く
			expect([...new Set(received.map((f) => f.id))].sort()).toEqual(
				all.filter((id) => canRead(role, id, seed)).sort()
			);
			expect(ownerMismatch(role, received)).toEqual([]);
		}
	});
