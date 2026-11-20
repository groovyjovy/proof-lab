import fc from 'fast-check';
import pg from 'pg';
import { beforeAll } from 'vitest';
import { restoreSeed } from '../../db/seed.ts';

process.loadEnvFile('.env.test');
process.loadEnvFile('.env');
fc.configureGlobal({ numRuns: 25 });

beforeAll(async () => {
	const client = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
	await client.connect();
	await restoreSeed(client);
	await client.end();
});
