import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect } from 'node:net';

export const faults = [
	'遅れて成功',
	'保存したが接続が切れる',
	'保存したがゲートウェイが504を返す',
	'サーバーに届かない(503)',
	'拒否する(409)',
	'応答が来ない',
	'ほかの人の更新が割り込む',
	'読み込みが遅れる',
	'読み込んだあとにほかの人の更新が割り込む',
	'検索の応答が遅れる'
] as const;
export type Fault = (typeof faults)[number];

const schedule: [number, Fault][] = [
	[35, '遅れて成功'],
	[15, '保存したが接続が切れる'],
	[15, '保存したがゲートウェイが504を返す'],
	[10, 'サーバーに届かない(503)'],
	[15, '拒否する(409)'],
	[10, '応答が来ない']
];

// 更新(PUT)には、ほかの人の更新が先に割り込む障害も起こす(1つのブラウザの探索では競合が起きないため)
const updateSchedule: [number, Fault][] = [...schedule, [20, 'ほかの人の更新が割り込む']];

const pick = (from: [number, Fault][]): Fault => {
	let r = Math.random() * from.reduce((sum, [w]) => sum + w, 0);
	for (const [w, fault] of from) if ((r -= w) < 0) return fault;
	return from[0][1];
};

/** `interfere` は、ほかの人の更新を1つ効かせる(版を上げ、そのキーも記録する)。 */
export function startProxy(port: number, upstream: URL, interfere: (id: number) => Promise<void>) {
	const counts = new Map<Fault, number>(faults.map((f) => [f, 0]));
	const log: { at: number; fault: Fault; key: string; reused: boolean }[] = [];
	/** 範囲の検索: 本人(as)、ブラウザが送った時刻、ブラウザに応答を返した時刻 */
	const searches: { as: string; sent: number; done: number }[] = [];
	const delay = () => (Math.random() < 0.3 ? 0 : 300 + Math.random() * 2000);
	const served = new WeakSet<object>();

	const forward = (
		req: IncomingMessage,
		res: ServerResponse,
		onResponse = (up: IncomingMessage) => {
			res.writeHead(up.statusCode ?? 502, up.headers);
			up.pipe(res);
		},
		body?: Buffer
	) => {
		const up = request(
			{
				host: upstream.hostname,
				port: upstream.port,
				method: req.method,
				path: req.url,
				headers: req.headers
			},
			onResponse
		);
		up.on('error', () => res.socket?.destroy());
		if (body) up.end(body);
		else req.pipe(up);
	};

	const server = createServer(async (req, res) => {
		const reused = served.has(req.socket);
		served.add(req.socket);
		const path = new URL(req.url ?? '/', 'http://proxy').pathname;
		const one = /^\/api\/features\/(\d+)$/.exec(path);
		if (req.method === 'GET' && path === '/api/features/search') {
			// サーバーに届く前と、サーバーが答えたあとの両方で遅らせる。応答は送った順に届かなくなり、
			// ログインし直したあとに、前の本人として送った検索の応答(か、本人違いの 412)が届く
			counts.set('検索の応答が遅れる', (counts.get('検索の応答が遅れる') ?? 0) + 1);
			const entry = {
				as: new URL(req.url ?? '/', 'http://proxy').searchParams.get('as') ?? '',
				sent: Date.now(),
				done: 0
			};
			searches.push(entry);
			return void setTimeout(
				() =>
					forward(req, res, (up) => {
						const chunks: Buffer[] = [];
						up.on('data', (c: Buffer) => chunks.push(c));
						up.on('end', () =>
							setTimeout(() => {
								entry.done = Date.now();
								res.writeHead(up.statusCode ?? 502, up.headers).end(Buffer.concat(chunks));
							}, delay())
						);
					}),
				delay()
			);
		}
		if (req.method === 'GET' && one && Math.random() < 0.5) {
			counts.set('読み込みが遅れる', (counts.get('読み込みが遅れる') ?? 0) + 1);
			return void setTimeout(() => forward(req, res), 500 + Math.random() * 1500);
		}
		if (req.method === 'GET' && one && Math.random() < 0.4) {
			// 画面が編集を始めたあとに、ほかの人の更新が効く(変更の流れで、編集中の画面に警告が届く。P14)
			const fault = '読み込んだあとにほかの人の更新が割り込む';
			counts.set(fault, (counts.get(fault) ?? 0) + 1);
			return forward(req, res, (up) => {
				res.writeHead(up.statusCode ?? 502, up.headers);
				up.pipe(res);
				up.on('end', () => setTimeout(() => void interfere(Number(one[1])), 300));
			});
		}
		const creating = req.method === 'POST' && path === '/api/features';
		const updating = req.method === 'PUT' && one !== null;
		if (!creating && !updating) return forward(req, res);
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk);
		const body = Buffer.concat(chunks);
		const fault = pick(updating ? updateSchedule : schedule);
		counts.set(fault, (counts.get(fault) ?? 0) + 1);
		log.push({ at: Date.now(), fault, key: String(JSON.parse(String(body)).key), reused });
		switch (fault) {
			case '遅れて成功':
				return void setTimeout(
					() => forward(req, res, undefined, body),
					500 + Math.random() * 1500
				);
			case '保存したが接続が切れる':
				return forward(
					req,
					res,
					(up) => {
						up.resume();
						up.on('end', () => res.socket?.destroy());
					},
					body
				);
			case '保存したがゲートウェイが504を返す':
				return forward(
					req,
					res,
					(up) => {
						up.resume();
						up.on('end', () => res.writeHead(504).end());
					},
					body
				);
			case 'サーバーに届かない(503)':
				return void res.writeHead(503).end();
			case '拒否する(409)':
				return void res
					.writeHead(409, { 'content-type': 'application/json' })
					.end('{"ok":false,"reason":"conflict"}');
			case '応答が来ない':
				return void setTimeout(() => res.socket?.destroy(), 30_000).unref();
			case 'ほかの人の更新が割り込む':
				await interfere(Number(one?.[1]));
				return forward(req, res, undefined, body);
			case '読み込みが遅れる':
				return forward(req, res, undefined, body);
		}
	});

	server.on('upgrade', (req, socket, head) => {
		const up = connect(Number(upstream.port), upstream.hostname, () => {
			const headers = req.rawHeaders.reduce(
				(lines, v, i) => (i % 2 ? `${lines}: ${v}\r\n` : `${lines}${v}`),
				''
			);
			up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n`);
			up.write(head);
			socket.pipe(up).pipe(socket);
		});
		up.on('error', () => socket.destroy());
		socket.on('error', () => up.destroy());
	});

	server.listen(port);
	return {
		counts,
		log,
		searches,
		close: () => {
			server.closeAllConnections();
			server.close();
		}
	};
}
