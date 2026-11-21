import { startDevServer } from '../../scripts/dev-server.ts';
import { buildSpec } from '../../scripts/spec-oracle.ts';

export default function setup() {
	process.loadEnvFile('.env.test');
	process.loadEnvFile('.env');
	buildSpec();
	return startDevServer(process.env.BETTER_AUTH_URL ?? '');
}
