import { startDevServer } from '../../scripts/dev-server.ts';

export default function setup() {
	process.loadEnvFile('.env.test');
	process.loadEnvFile('.env');
	return startDevServer(process.env.BETTER_AUTH_URL ?? '');
}
