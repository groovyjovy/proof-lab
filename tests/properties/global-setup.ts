import { spawn } from 'node:child_process';

export default async function setup() {
	process.loadEnvFile('.env.test');
	process.loadEnvFile('.env');
	const url = process.env.BETTER_AUTH_URL ?? '';
	const server = spawn(
		process.execPath,
		[
			'node_modules/vite/bin/vite.js',
			'dev',
			'--port',
			new URL(url).port,
			'--strictPort',
			'--mode',
			'test'
		],
		{ stdio: ['ignore', 'ignore', 'inherit'] }
	);
	for (let i = 0; i < 120; i++) {
		const status = await fetch(`${url}/api/features`).then(
			(r) => r.status,
			() => 0
		);
		if (status === 401) return () => server.kill();
		await new Promise((r) => setTimeout(r, 500));
	}
	server.kill();
	throw new Error(`テスト用サーバー ${url} が起動しなかった`);
}
