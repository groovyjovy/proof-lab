import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { identityChangedMessage } from '#lib/app/machine.ts';
import { open } from '../../scripts/driver.ts';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser?.close());

test('P11 本人の一致(ブラウザ): ほかのタブで別の利用者としてログインし直すと、元のタブは地図を動かした時点(タイルか範囲の検索が 412 になる)で操作を止め、ログイン画面に戻る', async () => {
	const context = await browser.newContext({
		baseURL: process.env.BETTER_AUTH_URL,
		viewport: { width: 1280, height: 800 }
	});
	const first = await context.newPage();
	const tab1 = await open(first);
	await tab1.login('b-staff');

	const tab2 = await open(await context.newPage());
	await tab2.reached('ログイン済み/閲覧');
	await tab2.press('ログアウト');
	await tab2.reached('未ログイン');
	await tab2.login('a-staff');

	// 地図を動かすと、タイルと範囲の検索の両方を、元のタブの本人(B市職員)として送る。先に 412 が届いたほうで止まる
	const refused: number[] = [];
	first.on('response', (r) => {
		const path = new URL(r.url()).pathname;
		if (path.startsWith('/tiles/') || path === '/api/features/search') refused.push(r.status());
	});
	await first.bringToFront();
	await first.locator('.maplibregl-ctrl-zoom-in').click();
	await tab1.reached('未ログイン');
	expect(await first.getByText(identityChangedMessage).count()).toBe(1);
	expect(refused.length).toBeGreaterThan(0);
	expect(refused.every((status) => status === 412)).toBe(true);
	await context.close();
});
