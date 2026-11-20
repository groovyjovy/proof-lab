import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect } from 'node:net';

export const faults = [
	'遅れて成功',
	'保存したが接続が切れる',
	'保存したがゲートウェイが504を返す',
	'サーバーに届かない(503)',
	'拒否する(409)',
	'応答が来ない'
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

const pick = (): Fault => {
	let r = Math.random() * schedule.reduce((sum, [w]) => sum + w, 0);
	for (const [w, fault] of schedule) if ((r -= w) < 0) return fault;
	return schedule[0][1];
};

export function startProxy(port: number, upstream: URL) {
	const counts = new Map<Fault, number>(faults.map((f) => [f, 0]));
	const log: { at: number; fault: Fault; key: string; reused: boolean }[] = [];
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
		if (req.method !== 'POST' || req.url !== '/api/features') return forward(req, res);
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk);
		const body = Buffer.concat(chunks);
		const fault = pick();
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
		close: () => {
			server.closeAllConnections();
			server.close();
		}
	};
}
