import { betterAuth } from 'better-auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { authOptions } from './auth-options.ts';
import { pool } from './db.ts';

const options = authOptions({ pool, secret: BETTER_AUTH_SECRET, baseURL: BETTER_AUTH_URL });

export const auth = betterAuth({
	...options,
	plugins: [...options.plugins, sveltekitCookies(getRequestEvent)]
});
