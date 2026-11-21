import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { featureResponse, requireActor, writeResponse } from '#lib/server/authz/index.ts';
import { parseEdit } from '#lib/server/feature-input.ts';

const idOf = (param: string) => {
	const id = Number(param);
	if (!Number.isInteger(id)) error(400, 'id が不正');
	return id;
};

export const GET: RequestHandler = async ({ locals, params, url }) =>
	featureResponse(await requireActor(locals, url).getFeature(idOf(params.id), true));

export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
	const id = idOf(params.id);
	return writeResponse(
		await requireActor(locals, url).saveFeature(id, parseEdit(await request.json()))
	);
};
