import { authClient } from '#lib/auth-client.ts';
import { roleOf, type Me } from '#lib/domain.ts';
import type { Draft, Effect, Reply } from './machine.ts';

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

export async function save(d: Draft, as: string, timeoutMs = saveTimeoutMs): Promise<Reply> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(`/api/features?as=${encodeURIComponent(as)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				key: d.key,
				city: d.city,
				public: d.public,
				name: `新しい地物 ${new Date().toLocaleString('ja-JP')}`,
				geometry: { type: 'Polygon', coordinates: [[...d.points, d.points[0]]] }
			}),
			signal: controller.signal
		});
		if (res.ok) return { type: '保存成功' };
		if (res.status === 412) return { type: '本人が変わった' };
		return { type: res.status < 500 ? '保存失敗' : '保存結果不明' };
	} catch {
		return { type: '保存結果不明' };
	} finally {
		clearTimeout(timer);
	}
}

export function run(effect: Effect): Promise<Reply> {
	switch (effect.type) {
		case 'ログインする':
			return logIn(effect.email);
		case 'ログアウトする':
			return logOut();
		case '保存する':
			return save(effect.draft, effect.as);
	}
}
