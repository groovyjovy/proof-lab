import { afterEach, expect, test, vi } from 'vitest';
import { run, save } from './effects.ts';

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
