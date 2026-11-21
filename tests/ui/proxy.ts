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

/**
 * 種と要求の名前から、0 以上 1 未満の数を決める(FNV-1a)。同じ種なら、要求が届く順番が変わっても、
 * 同じ要求(たとえば「キー k1 の2回目の保存」)には同じ数を返す。探索で見つけた現象を同じ種で再現するため。
 */
function chance(seed: number, ...parts: (string | number)[]) {
	let h = 0x811c9dc5;
	for (const c of `${seed}|${parts.join('|')}`) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193);
	return (h >>> 0) / 2 ** 32;
}

const pick = (r: number, from: [number, Fault][]): Fault => {
	let rest = r * from.reduce((sum, [w]) => sum + w, 0);
	for (const [w, fault] of from) if ((rest -= w) < 0) return fault;
	return from[0][1];
};

/** `interfere` は、ほかの人の更新を1つ効かせる(版を上げ、そのキーも記録する)。 */
export function startProxy(
	port: number,
	upstream: URL,
	seed: number,
	interfere: (id: number) => Promise<void>
) {
	const counts = new Map<Fault, number>(faults.map((f) => [f, 0]));
	const log: { at: number; fault: Fault; key: string; reused: boolean }[] = [];
	/** 範囲の検索: 本人(as)、ブラウザが送った時刻、ブラウザに応答を返した時刻 */
	const searches: { as: string; sent: number; done: number }[] = [];
	// 同じ要求の何回目か(再送や、同じ範囲の検索を区別する)
	const attempts = new Map<string, number>();
	const nth = (name: string) => {
		const n = (attempts.get(name) ?? 0) + 1;
		attempts.set(name, n);
		return n;
	};
	const delay = (...parts: (string | number)[]) =>
		chance(seed, ...parts, 'あるか') < 0.3 ? 0 : 300 + chance(seed, ...parts, '長さ') * 2000;
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
			const params = new URL(req.url ?? '/', 'http://proxy').searchParams;
			const entry = { as: params.get('as') ?? '', sent: Date.now(), done: 0 };
			const name = `検索 ${entry.as} ${params.get('bbox')}`;
			const n = nth(name);
			searches.push(entry);
			return void setTimeout(
				() =>
					forward(req, res, (up) => {
						const chunks: Buffer[] = [];
						up.on('data', (c: Buffer) => chunks.push(c));
						up.on('end', () =>
							setTimeout(
								() => {
									entry.done = Date.now();
									res.writeHead(up.statusCode ?? 502, up.headers).end(Buffer.concat(chunks));
								},
								delay(name, n, '答えたあと')
							)
						);
					}),
				delay(name, n, '届く前')
			);
		}
		if (req.method === 'GET' && one) {
			const name = `読み込み ${one[1]}`;
			const n = nth(name);
			if (chance(seed, name, n, 'あるか') < 0.5) {
				counts.set('読み込みが遅れる', (counts.get('読み込みが遅れる') ?? 0) + 1);
				return void setTimeout(() => forward(req, res), 500 + chance(seed, name, n, '長さ') * 1500);
			}
		}
		const creating = req.method === 'POST' && path === '/api/features';
		const updating = req.method === 'PUT' && one !== null;
		if (!creating && !updating) return forward(req, res);
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk);
		const body = Buffer.concat(chunks);
		const key = String(JSON.parse(String(body)).key);
		const name = `${updating ? '更新' : '保存'} ${key}`;
		const n = nth(name);
		const fault = pick(chance(seed, name, n, '障害'), updating ? updateSchedule : schedule);
		counts.set(fault, (counts.get(fault) ?? 0) + 1);
		log.push({ at: Date.now(), fault, key, reused });
		switch (fault) {
			case '遅れて成功':
				return void setTimeout(
					() => forward(req, res, undefined, body),
					500 + chance(seed, name, n, '長さ') * 1500
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
