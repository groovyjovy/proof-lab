import { authClient } from '#lib/auth-client.ts';
import { roleOf, type City, type Me } from '#lib/domain.ts';
import type { Draft, Edit, Effect, Hit, Notice, Query, Reply, SearchResult } from './machine.ts';

export const saveTimeoutMs = 10_000;
const demoPassword = 'password1234';

/** 本人の ID がなければ、要求に本人を書けない(P11)。そのときはログインできなかったことにする。 */
const meOf = (user: object, email: string): Me | null =>
	'id' in user && typeof user.id === 'string' && user.id !== ''
		? {
				id: user.id,
				name: 'name' in user && typeof user.name === 'string' ? user.name : email,
				role: roleOf('role' in user ? user.role : null),
				canEdit: 'canEdit' in user && user.canEdit === true
			}
		: null;

async function logIn(email: string): Promise<Reply> {
	try {
		const { data, error } = await authClient.signIn.email({ email, password: demoPassword });
		if (error) return { type: 'ログイン失敗', message: error.message ?? String(error.status) };
		const me = meOf(data.user, email);
		if (!me) return { type: 'ログイン失敗', message: 'サインインの応答に本人の ID がなかった' };
		return { type: 'ログイン成功', me };
	} catch {
		return { type: 'ログイン失敗', message: '通信できませんでした' };
	}
}

async function logOut(): Promise<Reply> {
	try {
		const { error } = await authClient.signOut();
		return { type: error ? 'ログアウト失敗' : 'ログアウト完了' };
	} catch {
		return { type: 'ログアウト失敗' };
	}
}

type Request = {
	path: string;
	params?: Record<string, string>;
	/** 画面が表示している本人(P11) */
	as: string;
	init?: RequestInit;
	timeoutMs: number;
};

/** 画面が表示している本人(`as`)として要求を送る(P11)。応答が来なければ、タイムアウトで打ち切る(L1)。
    本人が違うという応答(412)と、通信できなかったときの応答は、副作用ごとに決める。 */
async function call<R extends Reply | SearchResult>(
	{ path, params = {}, as, init = {}, timeoutMs }: Request,
	handle: (res: Response) => Promise<R>,
	otherwise: { failure: R; identityChanged: R }
): Promise<R> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${path}?${new URLSearchParams({ ...params, as })}`, {
			...init,
			signal: controller.signal
		});
		if (res.status === 412) return otherwise.identityChanged;
		return await handle(res);
	} catch {
		return otherwise.failure;
	} finally {
		clearTimeout(timer);
	}
}

const identityChanged = { type: '本人が変わった' } as const;

const json = { 'content-type': 'application/json' };

export const save = (d: Draft, as: string, timeoutMs = saveTimeoutMs) =>
	call<Reply>(
		{
			path: '/api/features',
			as,
			init: {
				method: 'POST',
				headers: json,
				body: JSON.stringify({
					key: d.key,
					city: d.city,
					public: d.public,
					name: `新しい地物 ${new Date().toLocaleString('ja-JP')}`,
					geometry: { type: 'Polygon', coordinates: [[...d.points, d.points[0]]] }
				})
			},
			timeoutMs
		},
		async (res) =>
			res.ok ? { type: '保存成功' } : { type: res.status < 500 ? '保存失敗' : '保存結果不明' },
		{ failure: { type: '保存結果不明' }, identityChanged }
	);

const isCity = (v: unknown): v is City => v === 'A' || v === 'B';

/** サーバーの今の版を読む。読むだけなので、結果が分からなくても害はなく、読めなかったことにする。 */
export const load = (id: number, as: string, timeoutMs = saveTimeoutMs) =>
	call<Reply>(
		{ path: `/api/features/${id}`, as, timeoutMs },
		async (res) => {
			if (!res.ok) return { type: '読み込めない' };
			const p = (await res.json())?.properties ?? {};
			if (
				!isCity(p.city) ||
				typeof p.public !== 'boolean' ||
				!Number.isInteger(p.version) ||
				typeof p.name !== 'string' ||
				typeof p.note !== 'string'
			)
				return { type: '読み込めない' };
			const ref = { id, city: p.city, public: p.public };
			return { type: '読み込めた', edit: { ref, version: p.version, name: p.name, note: p.note } };
		},
		{ failure: { type: '読み込めない' }, identityChanged }
	);

/** 更新。キー(P12)と読み込んだ版(P4)を書く。 */
export const update = (edit: Edit, key: string, as: string, timeoutMs = saveTimeoutMs) =>
	call<Reply>(
		{
			path: `/api/features/${edit.ref.id}`,
			as,
			init: {
				method: 'PUT',
				headers: json,
				body: JSON.stringify({
					key,
					version: edit.version,
					city: edit.ref.city,
					name: edit.name,
					note: edit.note
				})
			},
			timeoutMs
		},
		async (res) =>
			res.ok
				? { type: '保存成功' }
				: res.status === 409
					? { type: '競合した' }
					: { type: res.status < 500 ? '保存失敗' : '保存結果不明' },
		{ failure: { type: '保存結果不明' }, identityChanged }
	);

const hitOf = (f: unknown): Hit | null => {
	if (typeof f !== 'object' || f === null || !('id' in f) || !('properties' in f)) return null;
	const p = f.properties as Record<string, unknown> | null;
	if (!Number.isInteger(f.id) || !p || !isCity(p.city) || typeof p.public !== 'boolean')
		return null;
	if (typeof p.name !== 'string') return null;
	return {
		ref: { id: f.id as number, city: p.city, public: p.public },
		properties: { name: p.name }
	};
};

/** 範囲の検索。読むだけなので、結果が分からなくても害はなく、検索できなかったことにする。
    応答には、どの検索への応答かを番号で書く(検索は同時にいくつも飛ぶので)。 */
export async function search(query: Query, as: string, timeoutMs = saveTimeoutMs): Promise<Reply> {
	const [[west, south], [east, north]] = query.area;
	const result = await call<SearchResult>(
		{
			path: '/api/features/search',
			params: { bbox: [west, south, east, north].join(',') },
			as,
			timeoutMs
		},
		async (res) => {
			if (!res.ok) return { type: '検索できない' };
			const features: unknown = (await res.json())?.features;
			if (!Array.isArray(features)) return { type: '検索できない' };
			const hits = features.map(hitOf);
			if (hits.some((h) => h === null)) return { type: '検索できない' };
			return { type: '見つかった', hits: hits as Hit[] };
		},
		{ failure: { type: '検索できない' }, identityChanged }
	);
	return { type: '検索の応答', seq: query.seq, result };
}

export function run(effect: Effect): Promise<Reply> {
	switch (effect.type) {
		case 'ログインする':
			return logIn(effect.email);
		case 'ログアウトする':
			return logOut();
		case '保存する':
			return save(effect.draft, effect.as);
		case '読み込む':
			return load(effect.id, effect.as);
		case '更新する':
			return update(effect.edit, effect.key, effect.as);
		case '検索する':
			return search(effect.query, effect.as);
	}
}

const reconnectMs = { first: 1_000, max: 10_000 };

/**
 * 変更の流れ(P14)。本人(`as`)として開き、地物が変わるたびに知らせを渡す。状態機械の副作用ではなく、
 * 地図のタイルと同じく、状態機械の外で受けて知らせ(`Notice`)として渡す。戻り値で閉じる。
 * - 切れたらつなぎ直し、つなぎ直せたら「つなぎ直した」を渡す(切れている間の変更を取りこぼしたかもしれない)
 * - 本人違い(412)なら「地図の本人が変わった」を渡して終える。ログインしていなければ(401)終える
 */
export function subscribeChanges(as: string, deliver: (n: Notice) => void): () => void {
	const controller = new AbortController();
	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	void (async () => {
		let connected = 0;
		let delay = reconnectMs.first;
		while (!controller.signal.aborted) {
			try {
				const res = await fetch(`/api/events?${new URLSearchParams({ as })}`, {
					signal: controller.signal
				});
				if (res.status === 412) return deliver({ type: '地図の本人が変わった' });
				if (res.status === 401) return;
				if (!res.ok || !res.body) throw new Error(`変更の流れ: ${res.status}`);
				if (connected++ > 0) deliver({ type: '変更の流れをつなぎ直した', as });
				delay = reconnectMs.first;
				await readChanges(res.body, (change) =>
					deliver({ type: '地物が変わった', change: { ...change, as } })
				);
			} catch {
				if (controller.signal.aborted) return;
			}
			await wait(delay);
			delay = Math.min(delay * 2, reconnectMs.max);
		}
	})();
	return () => controller.abort();
}

/** Server-Sent Events の `data:` 行を1つずつ読む。形の違うものは捨てる。 */
async function readChanges(
	body: ReadableStream<Uint8Array>,
	onChange: (c: { id: number; version: number; key: string }) => void
) {
	const decoder = new TextDecoder();
	let buffer = '';
	for await (const chunk of body) {
		buffer += decoder.decode(chunk, { stream: true });
		const events = buffer.split('\n\n');
		buffer = events.pop() ?? '';
		for (const event of events)
			for (const line of event.split('\n')) {
				if (!line.startsWith('data: ')) continue;
				try {
					const v = JSON.parse(line.slice('data: '.length));
					if (Number.isInteger(v.id) && Number.isInteger(v.version) && typeof v.key === 'string')
						onChange({ id: v.id, version: v.version, key: v.key });
				} catch {
					// 形の違う行は捨てる
				}
			}
	}
}
