import { writeFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';
import { authOptions } from '../src/lib/server/auth-options.ts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
await pool.query('drop schema public cascade; create schema public;');
const { compileMigrations } = await getMigrations(
	authOptions({
		pool,
		secret: 'schema-generation-only-0123456789abcdef',
		baseURL: 'http://localhost'
	})
);
await writeFile('db/migrations/001_auth.sql', `${await compileMigrations()}\n`);
await pool.end();
