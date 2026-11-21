import { afterAll, beforeAll, expect, test } from 'vitest';
import { canRead, canWrite, roles, seesOwner, type City } from '#lib/domain.ts';
import { startOracle, type Oracle } from '../../scripts/spec-oracle.ts';

let oracle: Oracle;
beforeAll(() => {
	oracle = startOracle();
});
afterAll(() => oracle.close());

type Row = {
	role: (typeof roles)[number];
	canEdit: boolean;
	city: City;
	public: boolean;
	canRead: boolean;
	canWrite: boolean;
	seesOwner: boolean;
};

test('画面とテストが使う認可の判断(src/lib/domain.ts)は、Lean の判断表の32行すべてで仕様と同じ', async () => {
	const table = (await oracle.ask({ authzTable: true })) as Row[];
	expect(table).toHaveLength(32);
	for (const row of table) {
		const user = { role: row.role, canEdit: row.canEdit };
		const feature = { city: row.city, public: row.public };
		expect(
			{
				canRead: canRead(user, feature),
				canWrite: canWrite(user, feature),
				seesOwner: seesOwner(user)
			},
			JSON.stringify(row)
		).toEqual({ canRead: row.canRead, canWrite: row.canWrite, seesOwner: row.seesOwner });
	}
});
