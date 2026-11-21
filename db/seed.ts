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

const rectangle = (west: number, south: number, east: number, north: number): Geometry => ({
	type: 'Polygon',
	coordinates: [
		[
			[west, south],
			[east, south],
			[east, north],
			[west, north],
			[west, south]
		]
	]
});

const square = (lng: number, lat: number, size: number): Geometry =>
	rectangle(lng - size, lat - size, lng + size, lat + size);

export const seedBoundary = {
	left: 41,
	right: 42,
	west: 141.373,
	east: 141.397,
	south: 43.058,
	north: 43.08,
	center: 141.385,
	stride: 0.004
} as const;

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

seedFeatures.push(
	{
		id: seedBoundary.left,
		city: 'A',
		public: false,
		name: '境界編集 · 西区画',
		owner_name: 'デモ区画',
		geometry: rectangle(
			seedBoundary.west,
			seedBoundary.south,
			seedBoundary.center,
			seedBoundary.north
		)
	},
	{
		id: seedBoundary.right,
		city: 'A',
		public: false,
		name: '境界編集 · 東区画',
		owner_name: 'デモ区画',
		geometry: rectangle(
			seedBoundary.center,
			seedBoundary.south,
			seedBoundary.east,
			seedBoundary.north
		)
	}
);

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
	await client.query('truncate feature_update, boundary_pair, feature');
	for (const f of seedFeatures)
		await client.query(
			`insert into feature (id, city, public, name, owner_name, geom)
			 values ($1, $2, $3, $4, $5, st_setsrid(st_geomfromgeojson($6), 4326))`,
			[f.id, f.city, f.public, f.name, f.owner_name, JSON.stringify(f.geometry)]
		);
	await client.query(`select setval(pg_get_serial_sequence('feature', 'id'), $1)`, [
		seedFeatures.length
	]);
	const { left, right, west, south, east, north, center, stride } = seedBoundary;
	await client.query(
		`insert into boundary_pair (left_id, right_id, west, south, east, north, center, stride)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[left, right, west, south, east, north, center, stride]
	);
	for (const u of seedUsers)
		await client.query('update "user" set role = $1, "canEdit" = $2 where email = $3', [
			u.role,
			u.canEdit,
			u.email
		]);
	await client.query('commit');
}
