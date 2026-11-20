import type { RequestHandler } from './$types';
import { requireActor, tileResponse } from '#lib/server/authz/index.ts';
import { parseTile } from '#lib/server/feature-input.ts';

export const GET: RequestHandler = async ({ locals, params }) =>
	tileResponse(await requireActor(locals).tile(...parseTile(params)));
