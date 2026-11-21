import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { roles, statusAs, userIdOf } from './harness.ts';

const requests = [
	{ name: '地物一覧API', path: '/api/features' },
	{ name: '範囲検索API', path: '/api/features/search?bbox=141.25,43,141.45,43.1' },
	{ name: 'ベクタータイル', path: '/tiles/0/0/0' },
	{
		name: '作成',
		path: '/api/features',
		body: () => ({
			key: randomUUID(),
			city: 'A',
			public: true,
			name: '本人の確認',
			geometry: { type: 'Point', coordinates: [141.3, 43.05] }
		})
	}
];

test('P11 本人の一致: 要求に書いた本人(as)がログインしている本人と違えば、どの出口も 412 で答えない。自分なら 412 にならない', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom(...roles),
			fc.option(fc.constantFrom(...roles)),
			fc.constantFrom(...requests),
			async (me, other, request) => {
				const as = other === null ? null : await userIdOf(other);
				const status = await statusAs(me, request.path, as, request.body?.());
				if (other === me) expect(status).not.toBe(412);
				else expect(status).toBe(412);
			}
		),
		{ numRuns: 60 }
	);
});
