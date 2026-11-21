import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { seedBoundary as pair } from '../../db/seed.ts';
import { statusAs, userIdOf } from './harness.ts';

const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
beforeAll(() => db.connect());
afterAll(() => db.end());

const state = async () =>
	(
		await db.query(
			`select id::int, version, st_asewkt(geom) as shape
	 from feature where id in ($1,$2) order by id`,
			[pair.left, pair.right]
		)
	).rows;

async function move(
	id: number,
	expected: number,
	otherExpected: number,
	position: number,
	key = randomUUID()
) {
	return statusAs(
		'admin',
		`/api/features/${id}`,
		await userIdOf('admin'),
		{
			key,
			version: expected,
			city: 'A',
			name: '編集区画',
			note: '',
			boundary: {
				neighborId: id === pair.left ? pair.right : pair.left,
				neighborVersion: otherExpected,
				position
			}
		},
		'PUT'
	);
}

test('P17 共有境界の保存は2区画の版を同時に進め、同じキーで送り直しても一度だけ効く', async () => {
	const before = await state();
	const [left, right] = before;
	const key = randomUUID();
	expect(await move(pair.left, left.version, right.version, 2, key)).toBe(200);
	const committed = await state();
	expect(committed.map((row) => row.version)).toEqual([1, 1]);
	expect(committed.map((row) => row.shape)).not.toEqual(before.map((row) => row.shape));
	expect(await move(pair.left, left.version, right.version, 2, key)).toBe(200);
	expect(await state()).toEqual(committed);

	const expected = [
		pair.center + pair.stride,
		pair.west,
		pair.south,
		pair.east,
		pair.north,
		pair.left,
		pair.right
	];
	const {
		rows: [checked]
	} = await db.query(
		`select st_xmax(a.geom) = $1 as moved,
		        st_relate(a.geom, b.geom, 'F***1****') as touches,
		        st_equals(st_union(a.geom, b.geom), st_makeenvelope($2,$3,$4,$5,4326)) as complete
		 from feature a, feature b where a.id = $6 and b.id = $7`,
		expected
	);
	expect(checked).toEqual({ moved: true, touches: true, complete: true });
	const {
		rows: [geos]
	} = await db.query('select postgis_geos_version() as version');
	const [major, minor] = String(geos.version).split('.').map(Number);
	if (major > 3 || (major === 3 && minor >= 12)) {
		const {
			rows: [reference]
		} = await db.query(
			`select bool_and(invalid_edge is null) as valid from (
			  select st_coverageinvalidedges(geom) over () as invalid_edge from feature where id in ($1, $2)
			 ) checked`,
			[pair.left, pair.right]
		);
		expect(reference.valid).toBe(true);
	}
});

test('P17 両側からの同時更新は片方だけが通り、隣の版が古ければどちらも更新されない', async () => {
	const [left, right] = await state();
	const statuses = await Promise.all([
		move(pair.left, left.version, right.version, 0),
		move(pair.right, right.version, left.version, 1)
	]);
	expect(statuses.sort()).toEqual([200, 409]);
	const after = await state();
	expect(after.map((r) => r.version)).toEqual([2, 2]);
	expect(await move(pair.left, 2, 1, 2)).toBe(409);
	expect(await state()).toEqual(after);
});

test('P17 座標の更新は外部キーが取る KEY SHARE と両立する', async () => {
	const [left, right] = await state();
	const holding = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
	await holding.connect();
	await holding.query('begin');
	await holding.query('select id from feature where id = $1 for key share', [pair.right]);
	const saving = move(pair.left, left.version, right.version, 2);
	try {
		expect(
			await Promise.race([saving, new Promise((r) => setTimeout(r, 2_000, 'ロック待ち'))])
		).toBe(200);
	} finally {
		await holding.query('rollback');
		await holding.end();
		await saving;
	}
});
