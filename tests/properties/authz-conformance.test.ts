import { randomUUID } from 'node:crypto';
import { afterAll, expect, test } from 'vitest';
import { seedUsers } from '../../db/seed.ts';
import {
	exits,
	insertFeature,
	roles,
	setCanEdit,
	statusAs,
	userIdOf,
	type City
} from './harness.ts';
import { decision } from './rules.ts';

const cities: City[] = ['A', 'B'];
const list = exits[0];

afterAll(async () => {
	for (const u of seedUsers) await setCanEdit(u.user, u.canEdit);
});

// 判断の入力は有限(ロール4 × 編集権限2 × 市2 × 公開2 = 仕様の判断表の32行)なので、ランダムではなく全部を試す
const cases = roles.flatMap((role) =>
	[true, false].flatMap((canEdit) =>
		cities.flatMap((city) =>
			[true, false].flatMap((isPublic) =>
				cities.map((moveTo) => ({ role, canEdit, city, isPublic, moveTo }))
			)
		)
	)
);

test.each(cases)(
	'認可の突き合わせ: $role(編集権限 $canEdit)と $city 市・公開 $isPublic の地物で、読む・作る・$moveTo 市へ移して編集するの結果が、Lean の仕様の判断と同じ',
	async ({ role, canEdit, city, isPublic, moveTo }) => {
		await setCanEdit(role, canEdit);
		const id = await insertFeature(city, isPublic);
		const as = await userIdOf(role);
		const spec = decision(role, city, isPublic, canEdit);

		const received = (await list.fetch(role, [0, 0, 0, 0])).find((f) => f.id === id);
		expect(received !== undefined, '読めるか').toBe(spec.canRead);
		if (received) expect('owner_name' in received.properties, '所有者名').toBe(spec.seesOwner);

		const created = await statusAs(role, '/api/features', as, {
			key: randomUUID(),
			city,
			public: isPublic,
			name: '突き合わせ',
			geometry: { type: 'Point', coordinates: [141.3, 43.05] }
		});
		expect(created === 200, '作れるか').toBe(spec.canWrite);

		const moved = await statusAs(
			role,
			`/api/features/${id}`,
			as,
			{ version: 0, city: moveTo, name: '突き合わせ', note: '' },
			'PUT'
		);
		expect(moved === 200, '移して編集できるか').toBe(
			spec.canWrite && decision(role, moveTo, isPublic, canEdit).canWrite
		);
	}
);
