import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { openApp, type App } from '../../scripts/driver.ts';
import { countFeaturesWithKey } from '../properties/harness.ts';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser?.close());

const open = () => openApp(browser, process.env.BETTER_AUTH_URL ?? '');

const cachedCanEdit = async (page: App['page']) =>
	(await (await page.request.get('/api/auth/get-session')).json()).user.canEdit;

test('対照: 剥奪しなければ、画面で描いて保存した地物が1つできる', async () => {
	const app = await open();
	await app.login('a-staff');
	const key = await app.drawTriangle();
	expect(await app.save()).toBe(200);
	await app.reached('ログイン済み/閲覧');
	expect(await countFeaturesWithKey(key)).toBe(1);
	await app.page.close();
});

test('P3 剥奪後の書き込み禁止(ブラウザ): 描いている途中で剥奪されると、Cookie cache が古いままでも保存は拒否される', async () => {
	const app = await open();
	await app.login('a-staff');
	const key = await app.drawTriangle();
	const admin = await open();
	await admin.login('admin');
	expect(await admin.revokeEditPermission('a-staff')).toBe(200);
	expect
		.soft(
			await cachedCanEdit(app.page),
			'モデル2の反例と同じく、Cookie cache はまだ編集できると言っている'
		)
		.toBe(true);

	expect(await app.save()).toBe(403);
	await app.page.getByText('保存できませんでした').waitFor();
	expect(await countFeaturesWithKey(key)).toBe(0);
	expect(await app.kind()).toBe('ログイン済み/描画中');
	expect(await app.draftKey()).toBe(key);
	expect(await app.header()).not.toContain('編集不可');

	await app.page.reload();
	await app.reached('ログイン済み/閲覧');
	expect(await app.header()).toContain('編集不可');
	expect(await app.page.getByRole('button', { name: 'ポリゴンを描く' }).count()).toBe(0);
	await app.page.close();
	await admin.page.close();
});
