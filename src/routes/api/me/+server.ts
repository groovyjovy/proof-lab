import type { RequestHandler } from './$types';
import { meResponse, requireActor } from '#lib/server/authz/index.ts';

export const GET: RequestHandler = async ({ locals }) =>
	meResponse(await requireActor(locals).me());
