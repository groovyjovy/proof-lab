import { error, json } from '@sveltejs/kit';
import type { PoolClient } from 'pg';
import { roleOf, type City, type Me } from '#lib/domain.ts';
import { pool } from '../db.ts';

export type Bbox = [west: number, south: number, east: number, north: number];
export type Geometry =
	| { type: 'Point'; coordinates: [number, number] }
	| { type: 'Polygon'; coordinates: [number, number][][] };

declare const publicFeature: unique symbol;
export type PublicFeature = {
	type: 'Feature';
	id: number;
	geometry: Geometry;
	properties: {
		city: City;
		public: boolean;
		name: string;
		note: string;
		version: number;
		owner_name?: string;
	};
	readonly [publicFeature]: true;
};

declare const publicTile: unique symbol;
export type PublicTile = Uint8Array<ArrayBuffer> & { readonly [publicTile]: true };

export type NewFeature = {
	key: string;
	city: City;
	public: boolean;
	name: string;
	geometry: Geometry;
};
export type FeatureEdit = { version: number; city: City; name: string; note: string };
export type WriteResult =
	| { ok: true; id: number; version: number }
	| { ok: false; reason: 'forbidden' | 'conflict' | 'not-found' };

const visibleFeatureJson = `
	json_build_object(
		'type', 'Feature',
		'id', id,
		'geometry', st_asgeojson(geom)::json,
		'properties', json_strip_nulls(json_build_object(
			'city', city, 'public', public, 'name', name, 'note', note,
			'version', version, 'owner_name', owner_name
		))
	) as feature`;

const isRlsViolation = (e: unknown) =>
	typeof e === 'object' && e !== null && 'code' in e && e.code === '42501';

export function scopedDb(actorId: string) {
	async function run<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
		const client = await pool.connect();
		try {
			await client.query('begin');
			await client.query(`select set_config('app.user_id', $1, true)`, [actorId]);
			const result = await work(client);
			await client.query('commit');
			return result;
		} catch (e) {
			await client.query('rollback');
			throw e;
		} finally {
			client.release();
		}
	}

	const forbiddenOnRls = (e: unknown): WriteResult => {
		if (isRlsViolation(e)) return { ok: false, reason: 'forbidden' };
		throw e;
	};

	return {
		me: () =>
			run(async (c): Promise<Me> => {
				const { rows } = await c.query(
					`select name, role, coalesce("canEdit", false) as "canEdit" from "user" where id = app_user_id()`
				);
				return {
					id: actorId,
					name: rows[0].name,
					role: roleOf(rows[0].role),
					canEdit: rows[0].canEdit
				};
			}),

		listFeatures: () =>
			run(async (c) => {
				const { rows } = await c.query(
					`select ${visibleFeatureJson} from feature_visible order by id`
				);
				return rows.map((r): PublicFeature => r.feature);
			}),

		searchFeatures: ([west, south, east, north]: Bbox) =>
			run(async (c) => {
				const { rows } = await c.query(
					`select ${visibleFeatureJson} from feature_visible
					 where st_intersects(geom, st_makeenvelope($1, $2, $3, $4, 4326))
					 order by id`,
					[west, south, east, north]
				);
				return rows.map((r): PublicFeature => r.feature);
			}),

		tile: (z: number, x: number, y: number) =>
			run(async (c) => {
				const { rows } = await c.query(
					`with bounds as (select st_tileenvelope($1, $2, $3) as env),
					 tile as (
						select st_asmvtgeom(st_transform(f.geom, 3857), b.env) as geom,
							f.id, f.city, f.public, f.name, f.note, f.version, f.owner_name
						from feature_visible f, bounds b
						where f.geom && st_transform(b.env, 4326)
					 )
					 select st_asmvt(tile.*, 'features', 4096, 'geom', 'id') as mvt from tile`,
					[z, x, y]
				);
				return new Uint8Array(rows[0].mvt) as PublicTile;
			}),

		createFeature: (f: NewFeature) =>
			run(async (c): Promise<WriteResult> => {
				const inserted = await c.query(
					`insert into feature (request_key, city, public, name, owner_name, geom)
					 values ($1, $2, $3, $4, '', st_setsrid(st_geomfromgeojson($5), 4326))
					 on conflict (request_key) do nothing
					 returning id, version`,
					[f.key, f.city, f.public, f.name, JSON.stringify(f.geometry)]
				);
				const row =
					inserted.rows[0] ??
					(await c.query(`select id, version from feature where request_key = $1`, [f.key]))
						.rows[0];
				if (!row) return { ok: false, reason: 'conflict' };
				return { ok: true, id: Number(row.id), version: row.version };
			}).catch(forbiddenOnRls),

		saveFeature: (id: number, edit: FeatureEdit) =>
			run(async (c): Promise<WriteResult> => {
				const updated = await c.query(
					`update feature set city = $3, name = $4, note = $5, version = version + 1
					 where id = $1 and version = $2 returning version`,
					[id, edit.version, edit.city, edit.name, edit.note]
				);
				if (updated.rowCount) return { ok: true, id, version: updated.rows[0].version };
				const visible = await c.query(`select version from feature_visible where id = $1`, [id]);
				if (!visible.rowCount) return { ok: false, reason: 'not-found' };
				if (visible.rows[0].version !== edit.version) return { ok: false, reason: 'conflict' };
				return { ok: false, reason: 'forbidden' };
			}).catch(forbiddenOnRls)
	};
}

/** 要求に書かれた本人(`as`)として認可する。ログインしている本人と違えば 412(P11)。 */
export function requireActor(locals: App.Locals, url: URL) {
	if (!locals.actor) error(401, 'ログインが必要です');
	if (url.searchParams.get('as') !== locals.actor.id)
		error(412, '要求に書いた本人(as)が、ログインしている本人と違う(P11)');
	return scopedDb(locals.actor.id);
}

/** 画面を最初に描くときの本人。画面はこの本人を表示し、以後の要求の `as` に書く。 */
export const whoAmI = (locals: App.Locals) =>
	locals.actor ? scopedDb(locals.actor.id).me() : null;

export const featuresResponse = (features: readonly PublicFeature[]) =>
	json({ type: 'FeatureCollection', features });

export const tileResponse = (tile: PublicTile) =>
	new Response(tile, {
		headers: {
			'content-type': 'application/vnd.mapbox-vector-tile',
			'cache-control': 'private, no-store'
		}
	});

const statusOf = { forbidden: 403, conflict: 409, 'not-found': 404 } as const;

export const writeResponse = (result: WriteResult) =>
	result.ok ? json(result) : json(result, { status: statusOf[result.reason] });
