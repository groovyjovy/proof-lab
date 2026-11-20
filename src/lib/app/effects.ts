import { authClient } from '#lib/auth-client.ts';
import type { Me } from '#lib/server/authz/index.ts';
import type { Draft, Effect, Event } from './machine.ts';

export const saveTimeoutMs = 10_000;
const demoPassword = 'password1234';

const isMe = (v: unknown): v is Me =>
	typeof v === 'object' &&
	v !== null &&
	'name' in v &&
	typeof v.name === 'string' &&
	'role' in v &&
	(typeof v.role === 'string' || v.role === null) &&
	'canEdit' in v &&
	typeof v.canEdit === 'boolean';

async function logIn(email: string): Promise<Event> {
	try {
		const { error } = await authClient.signIn.email({ email, password: demoPassword });
		if (error) return { type: 'ログイン失敗', message: error.message ?? String(error.status) };
		const me: unknown = await (await fetch('/api/me')).json();
		return isMe(me)
			? { type: 'ログイン成功', me }
			: { type: 'ログイン失敗', message: 'ユーザー情報を読めませんでした' };
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
