import type { PageServerLoad } from './$types';
import { requireActor } from '#lib/server/authz/index.ts';

export const load: PageServerLoad = async ({ locals }) => ({
	me: locals.actor ? await requireActor(locals).me() : null
});
