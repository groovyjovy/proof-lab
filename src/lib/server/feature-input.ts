import { error } from '@sveltejs/kit';
import type { City } from '#lib/domain.ts';
import type { Bbox, FeatureEdit, Geometry, NewFeature } from './authz/index.ts';

type Body = Record<string, unknown>;

const isBody = (v: unknown): v is Body => typeof v === 'object' && v !== null;
const isCity = (v: unknown): v is City => v === 'A' || v === 'B';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPosition = (v: unknown): v is [number, number] =>
	Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber);

function parseGeometry(v: unknown): Geometry {
	if (isBody(v) && v.type === 'Point' && isPosition(v.coordinates))
		return { type: 'Point', coordinates: v.coordinates };
	if (
		isBody(v) &&
		v.type === 'Polygon' &&
		Array.isArray(v.coordinates) &&
		v.coordinates.length > 0 &&
		v.coordinates.every(
			(ring: unknown) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition)
		)
	)
		return { type: 'Polygon', coordinates: v.coordinates };
	error(400, 'geometry は Point か Polygon の GeoJSON');
}

export function parseBbox(param: string | null): Bbox {
	const v = param?.split(',').map(Number);
	if (!v || v.length !== 4 || !v.every(Number.isFinite))
		error(400, 'bbox は west,south,east,north の4つの数');
	const [west, south, east, north] = v;
	return [west, south, east, north];
}

export function parseTile(params: Record<string, string>): [z: number, x: number, y: number] {
	const [z, x, y] = [params.z, params.x, params.y].map(Number);
	const valid =
		Number.isInteger(z) && Number.isInteger(x) && Number.isInteger(y) && z >= 0 && z <= 22;
	if (!valid || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) error(400, 'タイル座標が不正');
	return [z, x, y];
}

const isUuid = (v: unknown): v is string =>
	typeof v === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function parseNewFeature(body: unknown): NewFeature {
	if (
		!isBody(body) ||
		!isUuid(body.key) ||
		!isCity(body.city) ||
		typeof body.public !== 'boolean' ||
		typeof body.name !== 'string'
	)
		error(400, '{ key(UUID), city, public, name, geometry } が必要');
	return {
		key: body.key,
		city: body.city,
		public: body.public,
		name: body.name,
		geometry: parseGeometry(body.geometry)
	};
}

export function parseEdit(body: unknown): FeatureEdit {
	if (
		!isBody(body) ||
		!Number.isInteger(body.version) ||
		!isCity(body.city) ||
		typeof body.name !== 'string' ||
		typeof body.note !== 'string'
	)
		error(400, '{ version, city, name, note } が必要');
	return { version: Number(body.version), city: body.city, name: body.name, note: body.note };
}
