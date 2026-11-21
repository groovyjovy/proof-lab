import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { seedFeatures } from '../../db/seed.ts';
import { openApp } from '../../scripts/driver.ts';
import { getOne, setCanEdit } from '../properties/harness.ts';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser?.close());

const open = () => openApp(browser, process.env.BETTER_AUTH_URL ?? '');
const target = seedFeatures.find((f) => f.city === 'A' && f.geometry.type === 'Point')!;

async function openWithAdmin() {
	const [staff, admin] = await Promise.all([open(), open()]);
	await admin.login('admin');
	return { staff, admin };
}

test('P15 描画中に編集権限を外すと、下書きは残り確定を押せなくなる', async () => {
	const { staff, admin } = await openWithAdmin();
	try {
		await staff.login('a-staff');
		const key = await staff.drawTriangle();
		expect(await admin.revokeEditPermission('a-staff')).toBe(200);
		await staff.page.locator('[data-not-permitted]').waitFor();
		expect(await staff.page.getByRole('button', { name: '確定して保存' }).isDisabled()).toBe(true);
		expect(await staff.kind()).toBe('ログイン済み/描画中');
		expect(await staff.draftKey()).toBe(key);
		expect(await staff.page.locator('[data-draft-points="3"]').count()).toBe(1);
	} finally {
		await Promise.all([staff.page.close(), admin.page.close()]);
		await setCanEdit('a-staff', true);
	}
});

test('P15 A市からB市に異動すると、開いているポップアップと古い一覧が消え、B市の一覧を読み直す', async () => {
	const { staff, admin } = await openWithAdmin();
	try {
		await staff.login('a-staff');
		await staff.page.locator('[data-hit-city="A"]').first().waitFor();
		await staff.openFeature(target.id);
		const search = await staff.hold('/api/features/search', 'GET');
		expect(await admin.setRole('a-staff', 'b-staff')).toBe(200);
		await staff.page.locator('[data-role="b-staff"]').waitFor();
		await staff.page.locator('.maplibregl-popup').waitFor({ state: 'detached' });
		await staff.page.locator('[data-search="検索中"]').waitFor();
		expect(await staff.page.locator('[data-search="検索中"] [data-hit-city]').count()).toBe(0);
		await search.release();
		await staff.page.locator('[data-search="見つかった"] [data-hit-city="B"]').first().waitFor();
		expect(await staff.page.locator('[data-hit-city="A"]').count()).toBe(0);
	} finally {
		await admin.setRole('a-staff', 'a-staff');
		await Promise.all([staff.page.close(), admin.page.close()]);
	}
});

test('P15 効いた更新の応答を失い、編集権限を外されたあと再送を拒否されても結果不明のまま', async () => {
	const { staff, admin } = await openWithAdmin();
	try {
		const events = (url: URL) => url.pathname === '/api/events';
		await staff.page.route(events, (route) => route.abort());
		await staff.login('a-staff');
		await staff.openFeature(target.id);
		await staff.press('編集を始める');
		await staff.reached('ログイン済み/編集中');
		await staff.fill('名前', '応答を失った更新');
		const path = `/api/features/${target.id}`;
		const isUpdate = (url: URL) => url.pathname === path;
		let committedStatus: number | undefined;
		await staff.page.route(isUpdate, async (route) => {
			committedStatus = (await route.fetch()).status();
			await route.fulfill({ status: 504, body: '' });
		});
		expect(await staff.save('保存する')).toBe(504);
		expect(committedStatus).toBe(200);
		await staff.reached('ログイン済み/更新結果不明');
		await staff.page.unroute(isUpdate);
		expect((await getOne('admin', String(target.id)))?.properties.name).toBe('応答を失った更新');

		expect(await admin.revokeEditPermission('a-staff')).toBe(200);
		await staff.page.unroute(events);
		await staff.page.getByText('A市職員(a-staff・編集不可)', { exact: true }).waitFor();
		const retry = await staff.hold(path, 'PUT');
		const rejected = staff.page.waitForResponse(
			(r) => new URL(r.url()).pathname === path && r.request().method() === 'PUT'
		);
		await staff.press('再送する');
		await staff.reached('ログイン済み/更新の再送中');
		await retry.release();
		expect((await rejected).status()).toBe(403);
		await staff.page.getByText(/再送を受け付けてもらえませんでした/).waitFor();
		expect(await staff.kind()).toBe('ログイン済み/更新結果不明');
	} finally {
		await Promise.all([staff.page.close(), admin.page.close()]);
		await setCanEdit('a-staff', true);
	}
});
