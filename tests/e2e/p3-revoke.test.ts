import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { countFeaturesWithKey, login } from '../properties/harness.ts';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser?.close());

const panel = (page: Page, attributes = '') => page.locator(`section[data-app]${attributes}`);
const header = (page: Page) => panel(page).locator('span').first();

async function drawTriangleAsAStaff() {
	const page = await browser.newPage({
		baseURL: process.env.BETTER_AUTH_URL,
		viewport: { width: 1280, height: 800 }
	});
	await page.goto('/', { waitUntil: 'networkidle' });
	await page.getByRole('button', { name: 'A市職員', exact: true }).click();
	await panel(page, '[data-screen="閲覧"]').waitFor();
	await page.getByRole('button', { name: 'ポリゴンを描く' }).click();
	await page.locator('canvas.maplibregl-canvas').waitFor();
	for (const [i, [x, y]] of [
		[500, 300],
		[700, 300],
		[600, 500]
	].entries()) {
		await page.mouse.click(x, y);
		await panel(page, `[data-draft-points="${i + 1}"]`).waitFor();
	}
	return { page, key: (await panel(page).getAttribute('data-draft-key')) ?? '' };
}

async function save(page: Page) {
	const response = page.waitForResponse(
		(r) => r.url().endsWith('/api/features') && r.request().method() === 'POST'
	);
	await page.getByRole('button', { name: '確定して保存' }).click();
	return (await response).status();
}

const cachedCanEdit = async (page: Page) =>
	(await (await page.request.get('/api/auth/get-session')).json()).user.canEdit;

test('対照: 剥奪しなければ、画面で描いて保存した地物が1つできる', async () => {
	const { page, key } = await drawTriangleAsAStaff();
	expect(await save(page)).toBe(200);
	await panel(page, '[data-screen="閲覧"]').waitFor();
	expect(await countFeaturesWithKey(key)).toBe(1);
	await page.close();
});

test('P3 剥奪後の書き込み禁止(ブラウザ): 描いている途中で剥奪されると、Cookie cache が古いままでも保存は拒否される', async () => {
	const { page, key } = await drawTriangleAsAStaff();
	expect(await (await login('admin')).revokeEditPermission('a-staff')).toEqual({ ok: true });
	expect
		.soft(
			await cachedCanEdit(page),
			'モデル2の反例と同じく、Cookie cache はまだ編集できると言っている'
		)
		.toBe(true);

	expect(await save(page)).toBe(403);
	await page.getByText('保存できませんでした').waitFor();
	expect(await countFeaturesWithKey(key)).toBe(0);
	expect(await panel(page).getAttribute('data-screen')).toBe('描画中');
	expect(await panel(page).getAttribute('data-draft-key')).toBe(key);
	expect(await header(page).textContent()).not.toContain('編集不可');

	await page.reload();
	await panel(page, '[data-screen="閲覧"]').waitFor();
	expect(await header(page).textContent()).toContain('編集不可');
	expect(await page.getByRole('button', { name: 'ポリゴンを描く' }).count()).toBe(0);
	await page.close();
});
