import { expect, test, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ DATABASE_URL: 'postgres://使わない' }));
const { changesResponse } = await import('./changes.ts');

type Subscriber = Parameters<Parameters<typeof changesResponse>[1] & object>[0];

/** 購読を手で進める。`start` で購読が始まり、`deliver` で変更が届く。 */
function manualHub() {
	let subscriber: Subscriber | undefined;
	let start = () => {};
	const subscribe = (s: Subscriber) =>
		new Promise<() => void>((resolve) => {
			start = () => {
				subscriber = s;
				resolve(() => {});
			};
		});
	return {
		subscribe,
		start: () => start(),
		deliver: (...a: Parameters<Subscriber['deliver']>) => subscriber!.deliver(...a)
	};
}

const later = (ms: number) => new Promise<'まだ'>((r) => setTimeout(() => r('まだ'), ms));
const text = (chunk: ReadableStreamReadResult<Uint8Array>) => new TextDecoder().decode(chunk.value);
const actorId = 'actor';
const me = async () => ({ id: actorId, name: 'A市職員', role: 'a-staff' as const, canEdit: true });

test('P14 変更の流れ: 最初の1行(つながった)は、知らせを受け始めてから送る。先に送ると、画面はつながったと思うが、その隙間に commit された変更は届かない', async () => {
	const hub = manualHub();
	const res = await changesResponse(
		{ actorId, me, getFeature: async () => undefined },
		hub.subscribe
	);
	const reader = res.body!.getReader();
	const first = reader.read();
	expect(await Promise.race([first.then(() => '届いた'), later(50)])).toBe('まだ');
	hub.start();
	expect(text(await first)).toContain('つながった');
	await reader.cancel();
});

test('P14・P1・P7 変更の流れ: 読める地物の変更だけを、届いた順に流す(読めるかの確かめに時間がかかっても、順番は変わらない)', async () => {
	const hub = manualHub();
	const visible = new Set([1, 3]);
	const getFeature = async (id: number) => {
		await new Promise((r) => setTimeout(r, id === 1 ? 30 : 0));
		return visible.has(id) ? ({ id } as never) : undefined;
	};
	const res = await changesResponse({ actorId, me, getFeature }, hub.subscribe);
	const reader = res.body!.getReader();
	hub.start();
	await reader.read();
	await reader.read();
	for (const id of [1, 2, 3]) hub.deliver({ id, version: 1, key: `k${id}` });
	const lines = [text(await reader.read()), text(await reader.read())];
	expect(lines).toEqual([
		`data: ${JSON.stringify({ id: 1, version: 1, key: 'k1' })}\n\n`,
		`data: ${JSON.stringify({ id: 3, version: 1, key: 'k3' })}\n\n`
	]);
	await reader.cancel();
});
