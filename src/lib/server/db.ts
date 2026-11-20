import pg from 'pg';
import { DATABASE_URL } from '$app/env/private';

export const pool = new pg.Pool({ connectionString: DATABASE_URL });
