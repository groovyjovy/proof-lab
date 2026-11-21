import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import {
	applyEdit,
	loadSeed,
	login,
	readMe,
	setCanEdit,
	statusAs,
	subscribe,
	userIdOf
} from './harness.ts';

test('P15 接続と再接続で、その時点の DB の本人が届く', async () => {
	const first = await subscribe('a-staff');
	try {
		await first.untilPermission(1);
		expect(first.permissions).toEqual([await readMe('a-staff')]);
	} finally {
		first.close();
	}
	await setCanEdit('a-staff', false);
	try {
		const reopened = await subscribe('a-staff');
		try {
			await reopened.untilPermission(1);
			expect(reopened.permissions).toEqual([await readMe('a-staff')]);
		} finally {
			reopened.close();
		}
	} finally {
		await setCanEdit('a-staff', true);
	}
});

test('P15 担当市と編集権限の変更は、その本人の流れにだけ届く', async () => {
	const admin = await login('admin');
	const [own, other] = await Promise.all([subscribe('a-staff'), subscribe('admin')]);
	try {
		await Promise.all([own.untilPermission(1), other.untilPermission(1)]);
		const original = await readMe('a-staff');
		const adminMe = await readMe('admin');
		expect(await admin.setRole('a-staff', 'b-staff')).toEqual({ ok: true });
		await own.untilPermission(2);
		const transferred = await readMe('a-staff');
		expect(transferred.role).toBe('b-staff');
		await setCanEdit('a-staff', false);
		await own.untilPermission(3);
		const revoked = await readMe('a-staff');
		expect(revoked.canEdit).toBe(false);
		// 両方が読める地物の知らせを待てば、その前の権限の知らせは両方で処理済み。
		const key = randomUUID();
		expect(await admin.create('B', key)).toEqual({ ok: true });
		await Promise.all([own.until(key), other.until(key)]);
		expect(own.permissions).toEqual([original, transferred, revoked]);
		expect(other.permissions).toEqual([adminMe]);
	} finally {
		own.close();
		other.close();
		await admin.setRole('a-staff', 'a-staff');
		await setCanEdit('a-staff', true);
	}
});

// モデル3がサーバーの応答として置いている前提(model/model3-app.ts の updateOutcomes と作成の応答)。
// 権限を外されたあとは、前に効いたキーの送り直しも 403 になる(RLS の with check が、キーを見るより先に効く)。
// だから画面は、送り直しの拒否を「効かなかった」と読まない(Lean の p15_resend_rejected_unknown)。
test('P15 編集権限を外されたあとは、もう効いた作成・更新のキーを送り直しても 403 になる', async () => {
	const seed = await loadSeed();
	const [featureId] = seed.featuresIn('A');
	const staff = await login('a-staff');
	const as = await userIdOf('a-staff');
	const createKey = randomUUID();
	const updateKey = randomUUID();
	expect(await staff.create('A', createKey)).toEqual({ ok: true });
	const loaded = await staff.load(featureId);
	const edited = applyEdit(loaded, 'a-staff');
	expect(await staff.save(featureId, edited, updateKey)).toEqual({ ok: true });
	await setCanEdit('a-staff', false);
	try {
		const created = {
			key: createKey,
			city: 'A',
			public: true,
			name: '作成テスト',
			geometry: { type: 'Point', coordinates: [141.3, 43.05] }
		};
		const updated = {
			key: updateKey,
			version: edited.version,
			city: edited.city,
			name: edited.properties.name,
			note: edited.properties.note
		};
		expect({
			create: await statusAs('a-staff', '/api/features', as, created, 'POST'),
			update: await statusAs('a-staff', `/api/features/${featureId}`, as, updated, 'PUT')
		}).toEqual({ create: 403, update: 403 });
	} finally {
		await setCanEdit('a-staff', true);
	}
});
