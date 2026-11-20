import { afterEach, expect, test, vi } from 'vitest';
import { save } from './effects.ts';

vi.mock('#lib/auth-client.ts', () => ({ authClient: {} }));
afterEach(() => vi.unstubAllGlobals());

const draft = {
	key: '00000000-0000-4000-8000-000000000000',
	city: 'A' as const,
	public: false,
	points: [
		[0, 0],
		[1, 0],
		[1, 1]
	] satisfies [number, number][]
};

const neverAnswers = (_: unknown, init: RequestInit) =>
	new Promise<Response>((_, reject) =>
		init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
	);

test('L1 保存中は必ず終わる(実行層の側): 応答が来なくても、タイムアウトで結果不明を返す', async () => {
	vi.stubGlobal('fetch', neverAnswers);
	expect(await save(draft, 50)).toEqual({ type: '保存結果不明' });
});

test.each([
	[200, '保存成功'],
	[403, '保存失敗'],
	[409, '保存失敗'],
	[500, '保存結果不明'],
	[502, '保存結果不明']
])('保存の応答 %i は %s(5xx はサーバーで保存されたか分からない)', async (status, type) => {
	vi.stubGlobal('fetch', async () => new Response('{}', { status }));
	expect(await save(draft, 1000)).toEqual({ type });
});

test('通信が切れたら結果不明(サーバーに届いたか分からない)', async () => {
	vi.stubGlobal('fetch', async () => {
		throw new TypeError('network');
	});
	expect(await save(draft, 1000)).toEqual({ type: '保存結果不明' });
});
