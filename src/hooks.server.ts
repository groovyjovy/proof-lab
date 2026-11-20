import type { Handle } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/env';
import { auth } from '#lib/server/auth.ts';

export const handle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.actor = session ? { id: session.user.id, name: session.user.name } : null;
	return svelteKitHandler({ event, resolve, auth, building });
};
