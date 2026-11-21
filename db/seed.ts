import type { ClientBase } from 'pg';

export type City = 'A' | 'B';
export type Bbox = [west: number, south: number, east: number, north: number];
type Geometry =
	| { type: 'Point'; coordinates: [number, number] }
	| { type: 'Polygon'; coordinates: [number, number][][] };

export type SeedFeature = {
	id: number;
	city: City;
	public: boolean;
	name: string;
	owner_name: string;
	geometry: Geometry;
};

export const extent: Bbox = [141.25, 43.0, 141.45, 43.1];
export const boundaryLng = 141.35;

const random = (() => {
	let s = 20261119;
	return () => {
		s = (s * 1103515245 + 12345) % 2 ** 31;
		return s / 2 ** 31;
	};
})();

const square = (lng: number, lat: number, size: number): Geometry => ({
	type: 'Polygon',
	coordinates: [
		[
			[lng - size, lat - size],
			[lng + size, lat - size],
			[lng + size, lat + size],
			[lng - size, lat + size],
			[lng - size, lat - size]
		]
	]
});

export const seedFeatures: SeedFeature[] = Array.from({ length: 40 }, (_, i) => {
	const [west, south, east, north] = extent;
	const crossesBoundary = i % 8 === 0;
	const nearBoundary = i % 8 === 4;
	const lng = crossesBoundary
		? boundaryLng + (random() - 0.5) * 0.004
		: nearBoundary
			? boundaryLng + (random() < 0.5 ? -1 : 1) * (0.001 + random() * 0.002)
			: west + 0.01 + random() * (east - west - 0.02);
	const lat = south + 0.01 + random() * (north - south - 0.02);
	const city: City = lng < boundaryLng ? 'A' : 'B';
	const geometry = crossesBoundary
		? square(lng, lat, 0.006)
		: i % 3 === 0
			? square(lng, lat, 0.002 + random() * 0.003)
			: ({ type: 'Point', coordinates: [lng, lat] } satisfies Geometry);
	const id = i + 1;
	return {
		id,
		city,
		public: random() < 0.5,
		name: `${city}市の地物${String(id).padStart(2, '0')}`,
		owner_name: `所有者${String(id).padStart(2, '0')}`,
		geometry
	};
});

export const seedPassword = 'password1234';

export const seedUsers = [
	{ user: 'admin', email: 'admin@example.com', name: '管理者', role: 'admin', canEdit: true },
	{
		user: 'a-staff',
		email: 'a-staff@example.com',
		name: 'A市職員',
		role: 'a-staff',
		canEdit: true
	},
	{
		user: 'b-staff',
		email: 'b-staff@example.com',
		name: 'B市職員',
		role: 'b-staff',
		canEdit: true
	},
	{ user: 'viewer', email: 'viewer@example.com', name: '閲覧者', role: 'viewer', canEdit: false }
] as const;

export async function restoreSeed(client: ClientBase) {
	await client.query('begin');
	await client.query('delete from "session"');
	await client.query('truncate feature_update, feature');
	for (const f of seedFeatures)
		await client.query(
			`insert into feature (id, city, public, name, owner_name, geom)
			 values ($1, $2, $3, $4, $5, st_setsrid(st_geomfromgeojson($6), 4326))`,
			[f.id, f.city, f.public, f.name, f.owner_name, JSON.stringify(f.geometry)]
		);
	await client.query(`select setval(pg_get_serial_sequence('feature', 'id'), $1)`, [
		seedFeatures.length
	]);
	for (const u of seedUsers)
		await client.query('update "user" set role = $1, "canEdit" = $2 where email = $3', [
			u.role,
			u.canEdit,
			u.email
		]);
	await client.query('commit');
}
