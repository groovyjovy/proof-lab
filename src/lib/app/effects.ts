import { authClient } from '#lib/auth-client.ts';
import type { Me } from '#lib/domain.ts';
import type { Draft, Effect, Event } from './machine.ts';

export const saveTimeoutMs = 10_000;
const demoPassword = 'password1234';

const meOf = (user: object, email: string): Me => ({
	name: 'name' in user && typeof user.name === 'string' ? user.name : email,
	role: 'role' in user && typeof user.role === 'string' ? user.role : null,
	canEdit: 'canEdit' in user && user.canEdit === true
});

async function logIn(email: string): Promise<Event> {
	try {
		const { data, error } = await authClient.signIn.email({ email, password: demoPassword });
		if (error) return { type: 'ログイン失敗', message: error.message ?? String(error.status) };
		return { type: 'ログイン成功', me: meOf(data.user, email) };
	} catch {
		return { type: 'ログイン失敗', message: '通信できませんでした' };
	}
}

async function logOut(): Promise<Event> {
	try {
		const { error } = await authClient.signOut();
		return { type: error ? 'ログアウト失敗' : 'ログアウト完了' };
	} catch {
		return { type: 'ログアウト失敗' };
	}
}

export async function save(d: Draft, timeoutMs = saveTimeoutMs): Promise<Event> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch('/api/features', {
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
		return { type: res.status < 500 ? '保存失敗' : '保存結果不明' };
	} catch {
		return { type: '保存結果不明' };
	} finally {
		clearTimeout(timer);
	}
}

export function run(effect: Effect): Promise<Event> {
	switch (effect.type) {
		case 'ログインする':
			return logIn(effect.email);
		case 'ログアウトする':
			return logOut();
		case '保存する':
			return save(effect.draft);
	}
}
