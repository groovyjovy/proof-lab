import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireActor, writeResponse } from '#lib/server/authz/index.ts';
import { parseEdit } from '#lib/server/feature-input.ts';

export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(400, 'id が不正');
	return writeResponse(
		await requireActor(locals, url).saveFeature(id, parseEdit(await request.json()))
	);
};
