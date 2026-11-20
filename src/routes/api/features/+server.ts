import type { RequestHandler } from './$types';
import { featuresResponse, requireActor, writeResponse } from '#lib/server/authz/index.ts';
import { parseNewFeature } from '#lib/server/feature-input.ts';

export const GET: RequestHandler = async ({ locals }) =>
	featuresResponse(await requireActor(locals).listFeatures());

export const POST: RequestHandler = async ({ locals, request }) =>
	writeResponse(await requireActor(locals).createFeature(parseNewFeature(await request.json())));
