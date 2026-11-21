import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { openApp, pixelOf } from '../../scripts/driver.ts';
import { login, userIdOf } from '../properties/harness.ts';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser?.close());

// z12 の x=3655 と x=3656 の境界。両方の断片が同じ緯度 y=1504 に入る。
const lng = 141.328125;
const lat = 43.05;
const ring = [
	[lng - 0.008, lat - 0.004],
	[lng + 0.008, lat - 0.004],
	[lng + 0.008, lat + 0.004],
	[lng - 0.008, lat + 0.004],
	[lng - 0.008, lat - 0.004]
];
const westTile = '/tiles/12/3655/1504';
const eastTile = '/tiles/12/3656/1504';
const origin = () => process.env.BETTER_AUTH_URL ?? '';
const popup = (page: Page) => page.locator('.maplibregl-popup');

async function selectTile(page: Page, side: -1 | 1, version: number) {
	const { x, y } = pixelOf([lng + side * 0.005, lat]);
	const attrs = popup(page).locator('dl');
	await expect
		.poll(
			async () => {
				await page.mouse.click(x, y);
				return attrs
					.locator('dt')
					.evaluateAll(
						(terms) =>
							terms.find((term) => term.textContent === '版')?.nextElementSibling?.textContent
					);
			},
			{ timeout: 10_000 }
		)
		.toBe(String(version));
}

test('P16 一枚のタイルに古い区画が残っていても、クリックした版と同じ地物だけを編集する', async () => {
	const app = await openApp(browser, origin());
	try {
		await app.login('admin');
		const as = await userIdOf('admin');
		const created = await app.page.request.post(`/api/features?as=${as}`, {
			headers: { origin: origin() },
			data: {
				key: randomUUID(),
				city: 'A',
				public: false,
				name: '二枚にまたがる区画',
				geometry: { type: 'Polygon', coordinates: [ring] }
			}
		});
		expect(created.status()).toBe(200);
		const { id } = await created.json();
		await selectTile(app.page, -1, 0);
		expect(await popup(app.page).getByText('二枚にまたがる区画').count()).toBe(1);
		const oldWest = await app.page.request.get(`${westTile}?as=${as}`);
		expect(oldWest.ok()).toBe(true);
		const body = await oldWest.body();

		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		await app.page.route(
			(url) => url.pathname === westTile,
			async (route) => {
				await held;
				await route.fulfill({ body, contentType: 'application/vnd.mapbox-vector-tile' });
			}
		);
		const eastArrived = app.page.waitForResponse(
			(r) => new URL(r.url()).pathname === eastTile && r.ok()
		);
		try {
			const other = await login('admin');
			const original = await other.load(String(id));
			expect(
				await other.save(String(id), {
					...original,
					properties: { ...original.properties, name: '公開された版1' }
				})
			).toEqual({ ok: true });
			await eastArrived;
		} finally {
			release();
		}
		await selectTile(app.page, 1, 1);
		expect(await popup(app.page).getByText('公開された版1').count()).toBe(1);
		await selectTile(app.page, -1, 0);
		await app.press('編集を始める');
		await app.page.locator('[data-map-lag]').waitFor({ timeout: 5_000 });
		await app.reached('ログイン済み/閲覧');

		await selectTile(app.page, -1, 0);
		expect(await app.page.getByRole('button', { name: '編集を始める' }).isDisabled()).toBe(true);
		await selectTile(app.page, 1, 1);
		await app.press('編集を始める');
		await app.reached('ログイン済み/編集中');
		expect(await app.page.getByLabel('名前').inputValue()).toBe('公開された版1');
	} finally {
		await app.page.close();
	}
});
