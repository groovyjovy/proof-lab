import pg from 'pg';
import { DATABASE_URL } from '$app/env/private';
import type { scopedDb } from './index.ts';

/** 効いて commit された変更(db/migrations/005_change_notice.sql が知らせる)。 */
export type FeatureChange = { id: number; version: number; key: string };

type Subscriber = { deliver: (c: FeatureChange) => void; lost: () => void };

/**
 * PostgreSQL の知らせ(feature_changed)を、プロセスに1本の接続で受け、購読者に配る。
 * 開発サーバーの再読み込み(HMR)でも1本のままにするため、globalThis に置く。
 * 接続が切れたら、購読者に知らせて流れを閉じる(画面はつなぎ直し、取りこぼした分は読み直す)。
 */
function createHub() {
	const subscribers = new Set<Subscriber>();
	let client: pg.Client | null = null;

	const connect = async () => {
		const c = new pg.Client({ connectionString: DATABASE_URL });
		const drop = () => {
			if (client !== c) return;
			client = null;
			for (const s of subscribers) s.lost();
			subscribers.clear();
			void c.end().catch(() => {});
		};
		c.on('error', drop);
		c.on('end', drop);
		c.on('notification', (n) => {
			const change = parseChange(n.payload);
			if (change) for (const s of subscribers) s.deliver(change);
		});
		client = c;
		await c.connect();
		await c.query('listen feature_changed');
	};

	return {
		async subscribe(s: Subscriber) {
			if (!client) await connect();
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

const global = globalThis as { featureChanges?: ReturnType<typeof createHub> };
const hub = (global.featureChanges ??= createHub());

/**
 * 変更の流れ(Server-Sent Events)。本人(`db` の利用者)が読める地物の変更だけを流す(P1・P7。
 * 読めるかは、知らせが届いたときの RLS で決める)。届いた順を保つため、1つずつ確かめて流す。
 */
export async function changesResponse(db: ReturnType<typeof scopedDb>) {
	const encoder = new TextEncoder();
	let unsubscribe = () => {};
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let queue = Promise.resolve();
			// 最初の1行で応答を始める(画面は、ここで流れがつながったと分かる)
			controller.enqueue(encoder.encode(': つながった\n\n'));
			unsubscribe = await hub.subscribe({
				deliver: (change) => {
					queue = queue
						.then(async () => {
							if (await db.getFeature(change.id))
								controller.enqueue(encoder.encode(`data: ${JSON.stringify(change)}\n\n`));
						})
						.catch(() => controller.error(new Error('変更を確かめられなかった')));
				},
				lost: () => queue.then(() => controller.close())
			});
		},
		cancel: () => unsubscribe()
	});
	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }
	});
}
