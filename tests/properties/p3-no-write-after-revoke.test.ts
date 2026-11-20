import { expect, test } from 'vitest';
import { applyEdit, loadSeed, login } from './harness.ts';

test('P3 剥奪後の書き込み禁止: 編集権限を剥奪された後に送られた保存は失敗する(モデル2の反例の手順)', async () => {
	const seed = await loadSeed();
	const [featureId] = seed.featuresIn('A');
	const staff = await login('a-staff');
	const loaded = await staff.load(featureId);
	const edited = applyEdit(loaded, 'a-staff');
	expect(await (await login('admin')).revokeEditPermission('a-staff')).toEqual({ ok: true });
	expect(await staff.save(featureId, edited)).toEqual({ ok: false });
});
