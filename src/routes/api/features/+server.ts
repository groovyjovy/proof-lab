import type { RequestHandler } from './$types';
import { featuresResponse, requireActor, writeResponse } from '#lib/server/authz/index.ts';
import { parseNewFeature } from '#lib/server/feature-input.ts';

export const GET: RequestHandler = async ({ locals, url }) =>
	featuresResponse(await requireActor(locals, url).listFeatures());

export const POST: RequestHandler = async ({ locals, request, url }) =>
	writeResponse(
		await requireActor(locals, url).createFeature(parseNewFeature(await request.json()))
	);
