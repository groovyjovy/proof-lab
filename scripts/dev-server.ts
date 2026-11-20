import { spawn } from 'node:child_process';

export async function startDevServer(
	origin: string,
	{ port = new URL(origin).port, quiet = false } = {}
): Promise<() => void> {
	const server = spawn(
		process.execPath,
		['node_modules/vite/bin/vite.js', 'dev', '--port', port, '--strictPort'],
		{
			env: { ...process.env, BETTER_AUTH_URL: origin },
			stdio: ['ignore', 'ignore', quiet ? 'ignore' : 'inherit']
		}
	);
	for (let i = 0; i < 120; i++) {
		const status = await fetch(`${origin}/api/features`).then(
			(r) => r.status,
			() => 0
		);
		if (status === 401) return () => server.kill();
		await new Promise((r) => setTimeout(r, 500));
	}
	server.kill();
	throw new Error(`開発サーバー ${origin}(${port} 番)が起動しなかった`);
}
