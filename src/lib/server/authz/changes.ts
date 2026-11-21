import pg from 'pg';
import { DATABASE_URL } from '$app/env/private';
import type { scopedDb } from './index.ts';

/** 効いて commit された変更(db/migrations/005_change_notice.sql が知らせる)。 */
export type FeatureChange = { id: number; version: number; key: string };

type Subscriber = {
	deliver: (c: FeatureChange) => void;
	permissionChanged: (id: string) => void;
	lost: () => void;
};

/**
 * PostgreSQL の知らせ(feature_changed・user_changed)を、プロセスに1本の接続で受け、購読者に配る。
 * 開発サーバーの再読み込み(HMR)でも1本のままにするため、globalThis に置く(再読み込みのあとに
 * 流れを3本開いても、LISTEN している接続は1本だった)。
 * 接続が切れたら、購読者に知らせて流れを閉じる(画面はつなぎ直し、取りこぼした分は読み直す)。
 */
function createHub() {
	const subscribers = new Set<Subscriber>();
	let client: pg.Client | null = null;
	let ready: Promise<void> | null = null;

	const connect = async () => {
		const c = new pg.Client({ connectionString: DATABASE_URL });
		const drop = () => {
			if (client !== c) return;
			client = null;
			ready = null;
			for (const s of subscribers) s.lost();
			subscribers.clear();
			void c.end().catch(() => {});
		};
		c.on('error', drop);
		c.on('end', drop);
		c.on('notification', (n) => {
			if (client !== c) return;
			if (n.channel === 'feature_changed') {
				const change = parseChange(n.payload);
				if (change) for (const s of subscribers) s.deliver(change);
			} else if (n.channel === 'user_changed') {
				const id = parseUserId(n.payload);
				if (id) for (const s of subscribers) s.permissionChanged(id);
			}
		});
		client = c;
		try {
			await c.connect();
			await c.query('listen feature_changed; listen user_changed');
		} catch (error) {
			drop();
			throw error;
		}
	};

	return {
		async subscribe(s: Subscriber): Promise<() => void> {
			const listening = (ready ??= connect());
			await listening;
			if (ready !== listening) throw new Error('変更の購読に接続できなかった');
			subscribers.add(s);
			return () => void subscribers.delete(s);
		}
	};
}

function parseChange(payload: string | undefined): FeatureChange | null {
	try {
		const v = JSON.parse(payload ?? '');
		return Number.isInteger(v.id) && Number.isInteger(v.version) && typeof v.key === 'string'
			? { id: v.id, version: v.version, key: v.key }
			: null;
	} catch {
		return null;
	}
}

function parseUserId(payload: string | undefined): string | null {
	try {
		const { id } = JSON.parse(payload ?? '');
		return typeof id === 'string' ? id : null;
	} catch {
		return null;
	}
}

const global = globalThis as { appChanges?: ReturnType<typeof createHub> };
const hub = (global.appChanges ??= createHub());

/**
 * 変更の流れ(Server-Sent Events)。本人(`db` の利用者)が読める地物の変更だけを流す(P1・P7。
 * 読めるかは、知らせが届いたときの RLS で決める)。届いた順を保つため、1つずつ確かめて流す。
 */
export async function changesResponse(
	db: Pick<ReturnType<typeof scopedDb>, 'actorId' | 'getFeature' | 'me'>,
	subscribe = hub.subscribe
) {
	const encoder = new TextEncoder();
	let unsubscribe = () => {};
	let open = true;
	const stop = () => {
		open = false;
		unsubscribe();
	};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let queue = Promise.resolve();
			const send = (value: unknown) => {
				if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
			};
			const sendMe = async () => send({ me: await db.me() });
			const enqueue = (work: () => void | Promise<void>) => {
				queue = queue
					.then(() => {
						if (open) return work();
					})
					.catch((error) => {
						if (!open) return;
						stop();
						controller.error(error);
					});
			};
			enqueue(async () => {
				unsubscribe = await subscribe({
					deliver: (change) =>
						enqueue(async () => {
							if (await db.getFeature(change.id)) send(change);
						}),
					permissionChanged: (id) => {
						if (id === db.actorId) enqueue(sendMe);
					},
					lost: () =>
						enqueue(() => {
							stop();
							controller.close();
						})
				});
				if (!open) return unsubscribe();
				// LISTEN が始まってから本人を送り、接続中に届いた変更もその後ろに並べる。
				controller.enqueue(encoder.encode(': つながった\n\n'));
				await sendMe();
			});
		},
		cancel: stop
	});
	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }
	});
}
