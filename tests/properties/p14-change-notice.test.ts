import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import {
	applyEdit,
	insertFeature,
	login,
	roles,
	subscribe,
	userIdOf,
	type City,
	type Role
} from './harness.ts';
import { decision } from './rules.ts';

// 変更の流れ(/api/events)の性質。画面の側の性質(知らせで応答待ちを抜けない、自分の更新の知らせで
// 警告しない、効いたキーの知らせでだけ結果不明を成功にする)は、Lean の証明(P14)とモデル3で確かめる。
// ここでは、その証明が前提にしている「サーバーは、効いた要求のキーを、読める人にだけ知らせる」を確かめる。

const open: { close: () => void }[] = [];
afterEach(() => {
	for (const s of open.splice(0)) s.close();
});
const subscribed = async (user: Role) => {
	const s = await subscribe(user);
	open.push(s);
	return s;
};

/** 管理者として地物を1回更新し、効いたキーを返す。 */
async function updateAsAdmin(id: string) {
	const admin = await login('admin');
	const key = randomUUID();
	const result = await admin.save(id, applyEdit(await admin.load(id), 'admin'), key);
	expect(result).toEqual({ ok: true });
	return key;
}

test('P14・P1・P7 変更の知らせは、その地物を読める人にだけ届く(読めるかは認可の仕様の判断表と同じ)', async () => {
	const streams = Object.fromEntries(
		await Promise.all(roles.map(async (r) => [r, await subscribed(r)] as const))
	);
	const features: [City, boolean][] = [
		['A', false],
		['A', true],
		['B', false],
		['B', true]
	];
	const changed: { key: string; city: City; public: boolean }[] = [];
	for (const [city, isPublic] of features)
		changed.push({
			key: await updateAsAdmin(await insertFeature(city, isPublic)),
			city,
			public: isPublic
		});
	// 最後に、それぞれが読める地物をもう1つずつ更新し、そこまで届いたら、前の変更はもう判断済み
	const sync = {
		admin: await updateAsAdmin(await insertFeature('B', true)),
		'a-staff': await updateAsAdmin(await insertFeature('A', true)),
		'b-staff': await updateAsAdmin(await insertFeature('B', true)),
		viewer: await updateAsAdmin(await insertFeature('B', true))
	};
	for (const role of roles) {
		await streams[role].until(sync[role]);
		const received = new Set(streams[role].changes.map((c) => c.key));
		const expected = changed
			.filter((c) => decision(role, c.city, c.public).canRead)
			.map((c) => c.key);
		expect(
			changed.map((c) => c.key).filter((k) => received.has(k)),
			role
		).toEqual(expected);
	}
});

test('P14 変更の知らせに載るのは、効いた更新のキーだけ。競合した更新、拒否された更新、もう効いたキーの送り直しは知らせない', async () => {
	const stream = await subscribed('a-staff');
	const id = await insertFeature('A', true);
	const [a, b] = [await login('a-staff'), await login('b-staff')];
	const loaded = await a.load(id);

	const first = await updateAsAdmin(id);
	const conflicted = randomUUID();
	expect(await a.save(id, applyEdit(loaded, 'a-staff'), conflicted)).toEqual({ ok: false });
	const refused = randomUUID();
	expect(await b.save(id, applyEdit(await a.load(id), 'b-staff'), refused)).toEqual({ ok: false });
	const applied = randomUUID();
	expect(await a.save(id, applyEdit(await a.load(id), 'a-staff'), applied)).toEqual({ ok: true });
	expect(await a.save(id, applyEdit(await a.load(id), 'a-staff'), applied)).toEqual({ ok: true });
	const last = await updateAsAdmin(id);

	await stream.until(last);
	expect(stream.changes.filter((c) => c.id === id).map((c) => [c.key, c.version])).toEqual([
		[first, 1],
		[applied, 2],
		[last, 3]
	]);
});

test('P11 変更の流れも、要求に書いた本人がセッションの本人と違えば 412 で開かない', async () => {
	const other = await userIdOf('viewer');
	const s = await subscribe('a-staff', other);
	expect(s.status).toBe(412);
	const own = await subscribed('a-staff');
	expect(own.status).toBe(200);
});
