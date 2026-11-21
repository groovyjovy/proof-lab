import { VectorTile } from '@mapbox/vector-tile';
import { randomUUID } from 'node:crypto';
import { PbfReader } from 'pbf';
import pg from 'pg';
import { extent, seedFeatures, seedPassword } from '../../db/seed.ts';

export const roles = ['admin', 'a-staff', 'b-staff', 'viewer'] as const;
export type Role = (typeof roles)[number];
export type User = Role;
export type City = 'A' | 'B';
export type Bbox = [west: number, south: number, east: number, north: number];

export type Received = { id: string; properties: Record<string, unknown> };

export type Exit = {
	name: string;
	fetch: (as: User, area: Bbox) => Promise<Received[]>;
};

export type Seed = {
	extent: Bbox;
	cityOf: (featureId: string) => City;
	isPublic: (featureId: string) => boolean;
	featuresIn: (city: City) => string[];
};

export type Loaded = { version: number; city: City; properties: Record<string, unknown> };

export type Session = {
	load: (featureId: string) => Promise<Loaded>;
	save: (featureId: string, edited: Loaded, key?: string) => Promise<{ ok: boolean }>;
	create: (city: City, key?: string) => Promise<{ ok: boolean }>;
	setRole: (user: User, role: Role) => Promise<{ ok: boolean }>;
	revokeEditPermission: (user: User) => Promise<{ ok: boolean }>;
};

const baseUrl = () => process.env.BETTER_AUTH_URL ?? '';
const tileZoom = 12;

let adminPool: pg.Pool | undefined;
const adminQuery = (sql: string, params: unknown[] = []) =>
	(adminPool ??= new pg.Pool({
		connectionString: process.env.DATABASE_ADMIN_URL,
		allowExitOnIdle: true
	})).query(sql, params);

/** 画面と同じく、データの要求には「誰として」(`as`)を書く(P11)。 */
const boundToActor = (path: string) =>
	path.startsWith('/api/features') || path.startsWith('/tiles/');

class Browser {
	#cookies = new Map<string, string>();
	actorId: string | undefined;

	async request(path: string, init: { method?: string; body?: unknown; as?: string | null } = {}) {
		const as = init.as === undefined ? this.actorId : init.as;
		if (boundToActor(path) && as !== null && as !== undefined)
			path += `${path.includes('?') ? '&' : '?'}as=${encodeURIComponent(as)}`;
		const headers = new Headers({ origin: baseUrl() });
		if (init.body !== undefined) headers.set('content-type', 'application/json');
		if (this.#cookies.size)
			headers.set('cookie', [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; '));
		const res = await fetch(baseUrl() + path, {
			method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			redirect: 'manual'
		});
		for (const setCookie of res.headers.getSetCookie()) {
			const [pair, ...attributes] = setCookie.split(';');
			const [name, ...value] = pair.split('=');
			const expired = value.join('=') === '' || attributes.some((a) => /^\s*max-age=0$/i.test(a));
			if (expired) this.#cookies.delete(name.trim());
			else this.#cookies.set(name.trim(), value.join('='));
		}
		return res;
	}

	async ok(path: string, init?: { method?: string; body?: unknown }) {
		const res = await this.request(path, init);
		await res.arrayBuffer();
		return { ok: res.ok };
	}

	async json<T>(path: string): Promise<T> {
		const res = await this.request(path);
		if (!res.ok) throw new Error(`${path} が ${res.status} を返した`);
		return res.json();
	}

	async bytes(path: string) {
		const res = await this.request(path);
		if (!res.ok) throw new Error(`${path} が ${res.status} を返した`);
		return new Uint8Array(await res.arrayBuffer());
	}
}

async function signIn(user: User) {
	const browser = new Browser();
	const res = await browser.request('/api/auth/sign-in/email', {
		body: { email: `${user}@example.com`, password: seedPassword }
	});
	if (!res.ok) throw new Error(`${user} のログインが ${res.status} で失敗した`);
	browser.actorId = (await res.json()).user.id;
	return browser;
}

const signedIn = new Map<User, Promise<Browser>>();
const browserOf = (user: User) => {
	if (!signedIn.has(user)) signedIn.set(user, signIn(user));
	return signedIn.get(user)!;
};

type FeatureCollection = { features: { id: number; properties: Record<string, unknown> }[] };
const toReceived = ({ features }: FeatureCollection): Received[] =>
	features.map((f) => ({ id: String(f.id), properties: f.properties }));

const tileX = (lng: number) => Math.floor(((lng + 180) / 360) * 2 ** tileZoom);
const tileY = (lat: number) => {
	const r = (lat * Math.PI) / 180;
	return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** tileZoom);
};

async function fetchTiles(as: User, [west, south, east, north]: Bbox) {
	const browser = await browserOf(as);
	const out: Received[] = [];
	for (let x = tileX(west); x <= tileX(east); x++)
		for (let y = tileY(north); y <= tileY(south); y++) {
			const layer = new VectorTile(
				new PbfReader(await browser.bytes(`/tiles/${tileZoom}/${x}/${y}`))
			).layers.features;
			for (let i = 0; i < (layer?.length ?? 0); i++) {
				const f = layer.feature(i);
				out.push({ id: String(f.id), properties: f.properties });
			}
		}
	return out;
}

export const exits: Exit[] = [
	{
		name: '地物一覧API',
		fetch: async (as) => toReceived(await (await browserOf(as)).json('/api/features'))
	},
	{
		name: '範囲検索API(bbox)',
		fetch: async (as, area) =>
			toReceived(await (await browserOf(as)).json(`/api/features/search?bbox=${area.join(',')}`))
	},
	{ name: 'ベクタータイル', fetch: fetchTiles }
];

const seedById = new Map(seedFeatures.map((f) => [String(f.id), f]));
const seedFeature = (id: string) => {
	const f = seedById.get(id);
	if (!f) throw new Error(`シードにない地物 ${id} を受け取った`);
	return f;
};

export const loadSeed = async (): Promise<Seed> => ({
	extent,
	cityOf: (id) => seedFeature(id).city,
	isPublic: (id) => seedFeature(id).public,
	featuresIn: (city) => seedFeatures.filter((f) => f.city === city).map((f) => String(f.id))
});

const userIdOf = async (user: User): Promise<string> =>
	(await adminQuery('select id from "user" where email = $1', [`${user}@example.com`])).rows[0].id;

export const login = async (user: User): Promise<Session> => {
	const browser = await signIn(user);
	return {
		load: async (featureId) => {
			const found = toReceived(await browser.json('/api/features')).find((f) => f.id === featureId);
			if (!found) throw new Error(`${user} には地物 ${featureId} が見えない`);
			const { version, city } = found.properties;
			return { version: Number(version), city: city as City, properties: found.properties };
		},
		save: (featureId, edited, key = randomUUID()) =>
			browser.ok(`/api/features/${featureId}`, {
				method: 'PUT',
				body: {
					key,
					version: edited.version,
					city: edited.city,
					name: edited.properties.name,
					note: edited.properties.note
				}
			}),
		create: (city, key = randomUUID()) =>
			browser.ok('/api/features', {
				body: {
					key,
					city,
					public: true,
					name: '作成テスト',
					geometry: { type: 'Point', coordinates: [city === 'A' ? 141.3 : 141.4, 43.05] }
				}
			}),
		setRole: async (target, role) =>
			browser.ok('/api/auth/admin/set-role', { body: { userId: await userIdOf(target), role } }),
		revokeEditPermission: async (target) =>
			browser.ok('/api/auth/admin/update-user', {
				body: { userId: await userIdOf(target), data: { canEdit: false } }
			})
	};
};

export const countFeaturesWithKey = async (key: string) =>
	Number(
		(await adminQuery('select count(*) from feature where request_key = $1', [key])).rows[0].count
	);

export const readPermissions = async (): Promise<unknown> =>
	(await adminQuery('select email, role, "canEdit" from "user" order by email')).rows;

const noteLines = (loaded: Loaded) => String(loaded.properties.note ?? '').split('\n');

export const applyEdit = (loaded: Loaded, editor: string): Loaded => ({
	...loaded,
	properties: { ...loaded.properties, note: [...noteLines(loaded), editor].join('\n') }
});

export const hasEdit = (loaded: Loaded, editor: string) => noteLines(loaded).includes(editor);

/** `as` に別の本人を書いた(`null` なら書かない)要求の応答の状態コード。 */
export const statusAs = async (
	user: User,
	path: string,
	as: string | null,
	body?: unknown,
	method?: string
): Promise<number> => {
	const res = await (await browserOf(user)).request(path, { as, body, method });
	await res.arrayBuffer();
	return res.status;
};

export const setCanEdit = (user: User, canEdit: boolean) =>
	adminQuery('update "user" set "canEdit" = $2 where email = $1', [`${user}@example.com`, canEdit]);

/** 管理者の接続(RLS を通らない)で地物を1つ入れ、その id を返す。 */
export const insertFeature = async (city: City, isPublic: boolean): Promise<string> =>
	String(
		(
			await adminQuery(
				`insert into feature (city, public, name, owner_name, geom)
				 values ($1, $2, '突き合わせ', '所有者', st_setsrid(st_makepoint($3, 43.05), 4326))
				 returning id`,
				[city, isPublic, city === 'A' ? 141.3 : 141.4]
			)
		).rows[0].id
	);

export { userIdOf };

/** 1件を読む API(画面が編集の前に今の版を読む)。読めなければ undefined。 */
export const getOne = async (user: User, id: string): Promise<Received | undefined> => {
	const res = await (await browserOf(user)).request(`/api/features/${id}`);
	if (res.status === 404) return undefined;
	if (!res.ok) throw new Error(`/api/features/${id} が ${res.status} を返した`);
	const f = await res.json();
	return { id: String(f.id), properties: f.properties };
};

/** 管理者の接続で、地物の版と、効かせた更新のキーの数を読む。 */
export const updateRecord = async (id: string) => {
	const { rows } = await adminQuery(
		`select f.version, (select count(*)::int from feature_update u where u.feature_id = f.id) as keys
		 from feature f where f.id = $1`,
		[id]
	);
	return rows[0] as { version: number; keys: number };
};
