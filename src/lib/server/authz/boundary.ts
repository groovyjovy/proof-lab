import type { PoolClient } from 'pg';
import type { BoundaryMove, BoundarySnapshot } from '#lib/boundary.ts';
import type { FeatureEdit, WriteResult } from './index.ts';

export async function boundarySnapshot(
	c: PoolClient,
	id: number
): Promise<BoundarySnapshot | undefined> {
	const { rows } = await c.query(
		`select (case when p.left_id = $1 then r.id else l.id end)::int as "neighborId",
		        case when p.left_id = $1 then r.version else l.version end as "neighborVersion",
		        case when st_xmax(l.geom) < p.center then 0
		             when st_xmax(l.geom) > p.center then 2 else 1 end as position
		 from boundary_pair p join feature l on l.id = p.left_id join feature r on r.id = p.right_id
		 where $1 in (p.left_id, p.right_id) and app_can_write(l.city, l.public)
		   and app_can_write(r.city, r.public)`,
		[id]
	);
	return rows[0];
}

/** 両方の行を同じ順序でロックし、両方の版と外枠の検査を通ったときだけ更新する。 */
export async function moveBoundary(
	c: PoolClient,
	id: number,
	edit: FeatureEdit,
	move: BoundaryMove
): Promise<WriteResult> {
	const { rows: pair } = await c.query(
		`select 1 from boundary_pair where left_id = least($1::bigint, $2::bigint)
		 and right_id = greatest($1::bigint, $2::bigint)`,
		[id, move.neighborId]
	);
	if (!pair.length) return { ok: false, reason: 'not-found' };
	const { rows: locked } = await c.query(
		`select id, version from feature where id in ($1, $2)
		 and app_can_write(city, public) order by id for no key update`,
		[id, move.neighborId]
	);
	if (locked.length !== 2) return { ok: false, reason: 'forbidden' };
	const expected = new Map([
		[id, edit.version],
		[move.neighborId, move.neighborVersion]
	]);
	if (locked.some((row) => row.version !== expected.get(Number(row.id))))
		return { ok: false, reason: 'conflict' };
	const version = Math.max(edit.version, move.neighborVersion) + 1;

	const updated = await c.query(
		`with bounds as (
		   select *, center + ($3::integer - 1) * stride as line
		   from boundary_pair where left_id = least($1::bigint, $2::bigint)
		     and right_id = greatest($1::bigint, $2::bigint)
		 ), shapes as (
		   select left_id, right_id,
		     st_makeenvelope(west, south, line, north, 4326) as lhs,
		     st_makeenvelope(line, south, east, north, 4326) as rhs,
		     st_makeenvelope(west, south, east, north, 4326) as outer_geom
		   from bounds
		 ), valid as (
		   select * from shapes where st_isvalid(lhs) and st_isvalid(rhs)
		     and st_relate(lhs, rhs, 'F***1****')
		     and st_equals(st_union(lhs, rhs), outer_geom)
		 )
		 update feature f set
		   geom = case when f.id = v.left_id then v.lhs else v.rhs end,
		   version = $4,
		   name = case when f.id = $1 then $5 else f.name end,
		   note = case when f.id = $1 then $6 else f.note end
		 from valid v where f.id in (v.left_id, v.right_id)`,
		[id, move.neighborId, move.position, version, edit.name, edit.note]
	);
	if (updated.rowCount === 0) return { ok: false, reason: 'conflict' };
	if (updated.rowCount !== 2) throw new Error('共有境界の片側しか更新できませんでした');
	await c.query(
		`select pg_notify('feature_changed', json_build_object(
		'id', $1::bigint, 'version', $2::int, 'key', $3::text)::text)`,
		[move.neighborId, version, edit.key]
	);
	return { ok: true, id, version };
}
