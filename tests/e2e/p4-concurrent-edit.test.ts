import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { seedFeatures } from '../../db/seed.ts';
import { openApp } from '../../scripts/driver.ts';
import { getOne } from '../properties/harness.ts';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser?.close());

const open = () => openApp(browser, process.env.BETTER_AUTH_URL ?? '');

// 管理者と A市職員の両方が編集できる、画面の中の A市の点の地物
const target = seedFeatures.find((f) => f.city === 'A' && f.geometry.type === 'Point')!;

test('P4 ロストアップデートなし(ブラウザ): 二人が同じ地物を同時に編集すると、後から保存した人は競合になり、読み直してから保存し直すと、両方の編集が残る', async () => {
	const admin = await open();
	await admin.login('admin');
	const staff = await open();
	await staff.login('a-staff');

	for (const app of [admin, staff]) {
		await app.openFeature(target.id);
		await app.press('編集を始める');
		await app.reached('ログイン済み/編集中');
	}

	await admin.fill('名前', '管理者が直した名前');
	expect(await admin.save('保存する')).toBe(200);
	await admin.reached('ログイン済み/閲覧');

	await staff.fill('備考', 'A市職員の備考');
	expect(await staff.save('保存する'), '同じ版を読んでいたので競合').toBe(409);
	await staff.reached('ログイン済み/競合');
	expect(await staff.page.getByRole('button', { name: '保存する' }).count()).toBe(0);

	await staff.press('読み直す');
	await staff.reached('ログイン済み/編集中');
	expect(await staff.page.getByLabel('名前').inputValue()).toBe('管理者が直した名前');
	await staff.fill('備考', 'A市職員の備考');
	expect(await staff.save('保存する')).toBe(200);
	await staff.reached('ログイン済み/閲覧');

	const final = await getOne('admin', String(target.id));
	expect(final?.properties).toMatchObject({
		name: '管理者が直した名前',
		note: 'A市職員の備考',
		version: 2
	});
});
