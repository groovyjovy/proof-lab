import { chromium, type Browser, type Route } from 'playwright-core';
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

test('P14 他人の保存が編集中に届く(ブラウザ): 編集している地物をほかの人が保存すると、保存する前に「ほかの人が更新した」と出る。打った編集は消えず、そのまま保存すると競合になる', async () => {
	const admin = await open();
	await admin.login('admin');
	const staff = await open();
	await staff.login('a-staff');
	for (const app of [admin, staff]) {
		await app.openFeature(target.id);
		await app.press('編集を始める');
		await app.reached('ログイン済み/編集中');
	}
	await staff.fill('備考', 'A市職員の備考');
	expect(await staff.page.locator('[data-stale]').count(), '誰も保存していないうちは出ない').toBe(
		0
	);

	await admin.fill('名前', '管理者が直した名前');
	expect(await admin.save('保存する')).toBe(200);
	await admin.reached('ログイン済み/閲覧');

	await staff.page.locator('[data-stale]').waitFor({ timeout: 5_000 });
	await staff.reached('ログイン済み/編集中');
	expect(await staff.page.getByLabel('備考').inputValue()).toBe('A市職員の備考');
	expect(await staff.save('保存する'), '同じ版を読んでいたので競合').toBe(409);
	await staff.reached('ログイン済み/競合');
});

test('P14 効いたという知らせが応答より先に届く(ブラウザ): 更新がサーバーで効いたあと応答が 504 になっても、変更の知らせで効いたと分かっているので、結果不明にせず成功にする', async () => {
	const admin = await open();
	await admin.login('admin');
	await admin.openFeature(target.id);
	await admin.press('編集を始める');
	await admin.reached('ログイン済み/編集中');
	await admin.fill('名前', '応答が失われた更新');
	const before = Number((await getOne('admin', String(target.id)))?.properties.version);

	// 更新をサーバーに届けて効かせ、応答はブラウザに返さずに止める
	const path = `/api/features/${target.id}`;
	let held: Route | undefined;
	const hold = async (route: Route) => {
		if (route.request().method() !== 'PUT' || held) return route.fallback();
		held = route;
		await route.fetch();
	};
	await admin.page.route((url) => url.pathname === path, hold);
	await admin.press('保存する');
	await admin.reached('ログイン済み/更新中');
	await admin.page.locator('[data-update-applied="true"]').waitFor({ timeout: 5_000 });

	await held!.fulfill({ status: 504, body: '' });
	await admin.page.unroute((url) => url.pathname === path, hold);
	await admin.reached('ログイン済み/閲覧');
	const after = await getOne('admin', String(target.id));
	expect(after?.properties).toMatchObject({ name: '応答が失われた更新', version: before + 1 });
});
