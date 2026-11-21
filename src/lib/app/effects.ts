import { authClient } from '#lib/auth-client.ts';
import { roleOf, type City, type Me } from '#lib/domain.ts';
import type { Draft, Edit, Effect, Reply } from './machine.ts';

export const saveTimeoutMs = 10_000;
const demoPassword = 'password1234';

/** 本人の ID がなければ、要求に本人を書けない(P11)。そのときはログインできなかったことにする。 */
const meOf = (user: object, email: string): Me | null =>
	'id' in user && typeof user.id === 'string' && user.id !== ''
		? {
				id: user.id,
				name: 'name' in user && typeof user.name === 'string' ? user.name : email,
				role: roleOf('role' in user ? user.role : null),
				canEdit: 'canEdit' in user && user.canEdit === true
			}
		: null;

async function logIn(email: string): Promise<Reply> {
	try {
		const { data, error } = await authClient.signIn.email({ email, password: demoPassword });
		if (error) return { type: 'ログイン失敗', message: error.message ?? String(error.status) };
		const me = meOf(data.user, email);
		if (!me) return { type: 'ログイン失敗', message: 'サインインの応答に本人の ID がなかった' };
		return { type: 'ログイン成功', me };
	} catch {
		return { type: 'ログイン失敗', message: '通信できませんでした' };
	}
}

async function logOut(): Promise<Reply> {
	try {
		const { error } = await authClient.signOut();
		return { type: error ? 'ログアウト失敗' : 'ログアウト完了' };
	} catch {
		return { type: 'ログアウト失敗' };
	}
}

/** 画面が表示している本人(`as`)として要求を送る(P11)。応答が来なければ、タイムアウトで打ち切る(L1)。 */
async function call(
	path: string,
	as: string,
	init: RequestInit,
	timeoutMs: number,
	handle: (res: Response) => Promise<Reply>,
	onFailure: Reply
): Promise<Reply> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`${path}?as=${encodeURIComponent(as)}`, {
			...init,
			signal: controller.signal
		});
		if (res.status === 412) return { type: '本人が変わった' };
		return await handle(res);
	} catch {
		return onFailure;
	} finally {
		clearTimeout(timer);
	}
}

const json = { 'content-type': 'application/json' };

export const save = (d: Draft, as: string, timeoutMs = saveTimeoutMs) =>
	call(
		'/api/features',
		as,
		{
			method: 'POST',
			headers: json,
			body: JSON.stringify({
				key: d.key,
				city: d.city,
				public: d.public,
				name: `新しい地物 ${new Date().toLocaleString('ja-JP')}`,
				geometry: { type: 'Polygon', coordinates: [[...d.points, d.points[0]]] }
			})
		},
		timeoutMs,
		async (res) =>
			res.ok ? { type: '保存成功' } : { type: res.status < 500 ? '保存失敗' : '保存結果不明' },
		{ type: '保存結果不明' }
	);

const isCity = (v: unknown): v is City => v === 'A' || v === 'B';

/** サーバーの今の版を読む。読むだけなので、結果が分からなくても害はなく、読めなかったことにする。 */
export const load = (id: number, as: string, timeoutMs = saveTimeoutMs) =>
	call(
		`/api/features/${id}`,
		as,
		{},
		timeoutMs,
		async (res): Promise<Reply> => {
			if (!res.ok) return { type: '読み込めない' };
			const p = (await res.json())?.properties ?? {};
			if (
				!isCity(p.city) ||
				typeof p.public !== 'boolean' ||
				!Number.isInteger(p.version) ||
				typeof p.name !== 'string' ||
				typeof p.note !== 'string'
			)
				return { type: '読み込めない' };
			const ref = { id, city: p.city, public: p.public };
			return { type: '読み込めた', edit: { ref, version: p.version, name: p.name, note: p.note } };
		},
		{ type: '読み込めない' }
	);

/** 更新。キー(P12)と読み込んだ版(P4)を書く。 */
export const update = (edit: Edit, key: string, as: string, timeoutMs = saveTimeoutMs) =>
	call(
		`/api/features/${edit.ref.id}`,
		as,
		{
			method: 'PUT',
			headers: json,
			body: JSON.stringify({
				key,
				version: edit.version,
				city: edit.ref.city,
				name: edit.name,
				note: edit.note
			})
		},
		timeoutMs,
		async (res) =>
			res.ok
				? { type: '保存成功' }
				: res.status === 409
					? { type: '競合した' }
					: { type: res.status < 500 ? '保存失敗' : '保存結果不明' },
		{ type: '保存結果不明' }
	);

export function run(effect: Effect): Promise<Reply> {
	switch (effect.type) {
		case 'ログインする':
			return logIn(effect.email);
		case 'ログアウトする':
			return logOut();
		case '保存する':
			return save(effect.draft, effect.as);
		case '読み込む':
			return load(effect.id, effect.as);
		case '更新する':
			return update(effect.edit, effect.key, effect.as);
	}
}
