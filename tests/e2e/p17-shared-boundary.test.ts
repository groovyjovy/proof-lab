import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { seedBoundary as pair } from '../../db/seed.ts';
import { clickBoundarySide, openApp } from '../../scripts/driver.ts';
import { getOne, statusAs, userIdOf } from '../properties/harness.ts';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser?.close());

const north = '/tiles/12/3656/1503';
const south = '/tiles/12/3656/1504';
const origin = () => process.env.BETTER_AUTH_URL ?? '';

test('P17 古い側のタイルでは共有境界を動かせず、両区画を確認すると一括で保存できる', async () => {
	const app = await openApp(browser, origin());
	try {
		await app.login('admin');
		const as = await userIdOf('admin');
		const oldNorth = await app.page.request.get(`${north}?as=${as}`);
		expect(oldNorth.ok()).toBe(true);
		const body = await oldNorth.body();
		const isNorth = (url: URL) => url.pathname === north;
		await app.page.route(isNorth, (route) =>
			route.fulfill({ body, contentType: 'application/vnd.mapbox-vector-tile' })
		);
		const southArrived = app.page.waitForResponse(
			(r) => new URL(r.url()).pathname === south && r.ok()
		);
		expect(
			await statusAs(
				'admin',
				`/api/features/${pair.left}`,
				as,
				{
					key: randomUUID(),
					city: 'A',
					version: 0,
					name: '境界編集 · 西区画',
					note: '',
					boundary: { neighborId: pair.right, neighborVersion: 0, position: 2 }
				},
				'PUT'
			)
		).toBe(200);
		await southArrived;

		const popup = app.page.locator('.maplibregl-popup');
		const enterLeft = async () => {
			await expect
				.poll(async () => {
					await clickBoundarySide(app.page, 'west');
					return popup
						.locator('dt')
						.evaluateAll(
							(terms) =>
								terms.find((term) => term.textContent === '版')?.nextElementSibling?.textContent
						);
				})
				.toBe('1');
			expect(await popup.getByText('境界編集 · 西区画').count()).toBe(1);
			await app.press('編集を始める');
			await app.reached('ログイン済み/編集中');
		};
		await enterLeft();

		const select = app.page.getByRole('combobox', { name: '共有境界の位置' });
		await clickBoundarySide(app.page, 'east');
		expect(await select.isDisabled()).toBe(true);
		await app.page.unroute(isNorth);
		await app.page.reload();
		await app.reached('ログイン済み/閲覧');
		await enterLeft();
		await expect
			.poll(
				async () => {
					await clickBoundarySide(app.page, 'east');
					return select.isEnabled();
				},
				{ timeout: 10_000 }
			)
			.toBe(true);

		await select.selectOption('0');
		expect(await app.save('保存する')).toBe(200);
		await app.reached('ログイン済み/閲覧');
		const updated = await Promise.all([
			getOne('admin', String(pair.left)),
			getOne('admin', String(pair.right))
		]);
		expect(updated.map((f) => f?.properties.version)).toEqual([2, 2]);
		expect(updated[0]?.properties.boundary).toMatchObject({ position: 0, neighborVersion: 2 });
	} finally {
		await app.page.close();
	}
});
