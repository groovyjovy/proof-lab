import type { RequestHandler } from './$types';
import { requireActor } from '#lib/server/authz/index.ts';
import { changesResponse } from '#lib/server/authz/changes.ts';

/** 変更の流れ(P14)。要求に書いた本人(`as`)として開く。セッションの本人と違えば 412(P11)。 */
export const GET: RequestHandler = ({ locals, url }) => changesResponse(requireActor(locals, url));
