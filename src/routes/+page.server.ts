import type { PageServerLoad } from './$types';
import { whoAmI } from '#lib/server/authz/index.ts';

export const load: PageServerLoad = async ({ locals }) => ({ me: await whoAmI(locals) });
