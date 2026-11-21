import type { RequestHandler } from './$types';
import { requireActor, tileResponse } from '#lib/server/authz/index.ts';
import { parseTile } from '#lib/server/feature-input.ts';

export const GET: RequestHandler = async ({ locals, params, url }) =>
	tileResponse(await requireActor(locals, url).tile(...parseTile(params)));
