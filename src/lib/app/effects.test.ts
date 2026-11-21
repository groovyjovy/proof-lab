import { afterEach, expect, test, vi } from 'vitest';
import { run, save, search } from './effects.ts';

const signIn = vi.hoisted(() => vi.fn());
vi.mock('#lib/auth-client.ts', () => ({ authClient: { signIn: { email: signIn } } }));
afterEach(() => {
	vi.unstubAllGlobals();
	signIn.mockReset();
});

const logIn = () => run({ type: 'ログインする', email: 'a-staff@example.com' });

test('ログインは1回の通信で終わる: サインインの応答から本人の情報を作り、ほかに問い合わせない', async () => {
	const fetch = vi.fn();
	vi.stubGlobal('fetch', fetch);
	signIn.mockResolvedValue({
		data: {
			user: {
				id: 'user-a',
				name: 'A市職員',
				email: 'a-staff@example.com',
				role: 'a-staff',
				canEdit: true
			}
		},
		error: null
	});
	expect(await logIn()).toEqual({
		type: 'ログイン成功',
		me: { id: 'user-a', name: 'A市職員', role: 'a-staff', canEdit: true }
	});
	expect(fetch).not.toHaveBeenCalled();
});

test('サインインが通ったら、ID 以外の本人の情報が欠けていてもログイン成功にする(Cookie は付いているので)。分からないロールは閲覧者として扱う', async () => {
	signIn.mockResolvedValue({ data: { user: { id: 'user-a', canEdit: null } }, error: null });
	expect(await logIn()).toEqual({
		type: 'ログイン成功',
		me: { id: 'user-a', name: 'a-staff@example.com', role: 'viewer', canEdit: false }
	});
});

test('P11 サインインの応答に本人の ID がなければ、要求に本人を書けないので、ログイン失敗にする', async () => {
	signIn.mockResolvedValue({ data: { user: { name: 'A市職員' } }, error: null });
	expect(await logIn()).toMatchObject({ type: 'ログイン失敗' });
});

test('サインインが拒否されたら、ログイン失敗', async () => {
	signIn.mockResolvedValue({
		data: null,
		error: { status: 401, message: 'Invalid email or password' }
	});
	expect(await logIn()).toEqual({ type: 'ログイン失敗', message: 'Invalid email or password' });
});

test('サインインが例外を投げても、ログイン失敗を1つ返す', async () => {
	signIn.mockRejectedValue(new TypeError('network'));
	expect(await logIn()).toEqual({ type: 'ログイン失敗', message: '通信できませんでした' });
});

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
	expect(await save(draft, 'u1', 50)).toEqual({ type: '保存結果不明' });
});

test.each([
	[200, '保存成功'],
	[403, '保存失敗'],
	[409, '保存失敗'],
	[412, '本人が変わった'],
	[500, '保存結果不明'],
	[502, '保存結果不明']
])('保存の応答 %i は %s(5xx はサーバーで保存されたか分からない)', async (status, type) => {
	vi.stubGlobal('fetch', async () => new Response('{}', { status }));
	expect(await save(draft, 'u1', 1000)).toEqual({ type });
});

test('通信が切れたら結果不明(サーバーに届いたか分からない)', async () => {
	vi.stubGlobal('fetch', async () => {
		throw new TypeError('network');
	});
	expect(await save(draft, 'u1', 1000)).toEqual({ type: '保存結果不明' });
});

test('P11 保存は、画面が表示している本人として送る(要求の as)', async () => {
	const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', fetch);
	await run({ type: '保存する', draft, as: 'user-1' });
	expect(fetch).toHaveBeenCalledWith('/api/features?as=user-1', expect.anything());
});

const query = {
	seq: 7,
	area: [
		[141, 43],
		[142, 44]
	] satisfies [[number, number], [number, number]]
};

test('P13 範囲の検索は、どの検索への応答かを番号で返し、範囲と本人(as)を要求に書く', async () => {
	const fetch = vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					type: 'FeatureCollection',
					features: [{ id: 3, properties: { city: 'B', public: false, name: '地物3', note: '' } }]
				}),
				{ status: 200 }
			)
	);
	vi.stubGlobal('fetch', fetch);
	expect(await run({ type: '検索する', query, as: 'user-1' })).toEqual({
		type: '検索の応答',
		seq: 7,
		result: {
			type: '見つかった',
			hits: [{ ref: { id: 3, city: 'B', public: false }, properties: { name: '地物3' } }]
		}
	});
	expect(fetch).toHaveBeenCalledWith(
		'/api/features/search?bbox=141%2C43%2C142%2C44&as=user-1',
		expect.anything()
	);
});

test.each([
	['本人違い(412)', async () => new Response('{}', { status: 412 }), '本人が変わった'],
	['サーバーの失敗', async () => new Response('{}', { status: 500 }), '検索できない'],
	['形の違う応答', async () => new Response('{"features":[{"id":"x"}]}'), '検索できない'],
	[
		'通信が切れた',
		async () => {
			throw new TypeError('network');
		},
		'検索できない'
	]
])('P13 範囲の検索: %s は、番号つきの「%s」', async (_, fetch, type) => {
	vi.stubGlobal('fetch', fetch);
	expect(await run({ type: '検索する', query, as: 'u1' })).toEqual({
		type: '検索の応答',
		seq: 7,
		result: { type }
	});
});

test('L1 範囲の検索も、応答が来なければタイムアウトで「検索できない」を返す', async () => {
	vi.stubGlobal('fetch', neverAnswers);
	expect(await search(query, 'u1', 50)).toEqual({
		type: '検索の応答',
		seq: 7,
		result: { type: '検索できない' }
	});
});
