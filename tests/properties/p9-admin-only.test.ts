import fc from 'fast-check';
import { expect, test } from 'vitest';
import { login, readPermissions, roles } from './harness.ts';

const nonAdmins = roles.filter((r) => r !== 'admin');

const change = fc.oneof(
	fc.record({
		kind: fc.constant('ロール変更' as const),
		user: fc.constantFrom(...roles),
		role: fc.constantFrom(...roles)
	}),
	fc.record({ kind: fc.constant('編集権限の剥奪' as const), user: fc.constantFrom(...roles) })
);

test('P9 権限変更は管理者だけ: 管理者以外は、ロールも編集権限も変えられない', async () => {
	await fc.assert(
		fc.asyncProperty(fc.constantFrom(...nonAdmins), change, async (actor, c) => {
			const before = await readPermissions();
			const session = await login(actor);
			const result =
				c.kind === 'ロール変更'
					? await session.setRole(c.user, c.role)
					: await session.revokeEditPermission(c.user);
			expect(result).toEqual({ ok: false });
			expect(await readPermissions()).toEqual(before);
		})
	);
});

test('P9 の対照: 管理者は閲覧者のロールを変えられる(P9 が何も確かめずに通っていないことの確認)', async () => {
	const before = await readPermissions();
	expect(await (await login('admin')).setRole('viewer', 'b-staff')).toEqual({ ok: true });
	expect(await readPermissions()).not.toEqual(before);
});
