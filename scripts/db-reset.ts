import { readdir, readFile } from 'node:fs/promises';
import { betterAuth } from 'better-auth';
import pg from 'pg';
import { restoreSeed, seedPassword, seedUsers } from '../db/seed.ts';
import { authOptions } from '../src/lib/server/auth-options.ts';

const appUrl = new URL(process.env.DATABASE_URL ?? '');
if (appUrl.username !== 'app')
	throw new Error('DATABASE_URL は app ロールで接続する(RLS を効かせるため)');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
const client = await pool.connect();

await client.query('drop schema public cascade; create schema public;');
const exists = await client.query(`select 1 from pg_roles where rolname = 'app'`);
const password = client.escapeLiteral(decodeURIComponent(appUrl.password));
await client.query(
	exists.rowCount
		? `alter role app login password ${password}`
		: `create role app login password ${password}`
);
await client.query('grant usage on schema public to app');

for (const file of (await readdir('db/migrations')).sort())
	await client.query(await readFile(`db/migrations/${file}`, 'utf8'));

const auth = betterAuth(
	authOptions({
		pool,
		secret: process.env.BETTER_AUTH_SECRET ?? '',
		baseURL: process.env.BETTER_AUTH_URL ?? ''
	})
);
for (const u of seedUsers)
	await auth.api.createUser({ body: { email: u.email, name: u.name, password: seedPassword } });

await restoreSeed(client);

client.release();
await pool.end();
