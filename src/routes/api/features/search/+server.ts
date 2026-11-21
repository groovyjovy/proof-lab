import type { RequestHandler } from './$types';
import { featuresResponse, requireActor } from '#lib/server/authz/index.ts';
import { parseBbox } from '#lib/server/feature-input.ts';

export const GET: RequestHandler = async ({ locals, url }) =>
	featuresResponse(
		await requireActor(locals, url).searchFeatures(parseBbox(url.searchParams.get('bbox')))
	);
