import { chromium, type Browser, type Page, type Route } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { identityChangedMessage } from '#lib/app/machine.ts';
import { open } from '../../scripts/driver.ts';

let browser: Browser;
beforeAll(async () => {
	browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(() => browser?.close());

const newPage = () =>
	browser.newPage({ baseURL: process.env.BETTER_AUTH_URL, viewport: { width: 1280, height: 800 } });

const isSearch = (url: URL) => url.pathname === '/api/features/search';

type Feature = { properties: { public: boolean } };

/**
 * 次の範囲の検索を1つ止める。`answered` ならサーバーに答えさせてから、応答をブラウザに返す途中で止める
 * (サーバーは、そのときのセッションの本人として答える)。`unsent` ならサーバーに届く前に止める。
 */
async function holdNextSearch(page: Page, at: 'answered' | 'unsent') {
	let release = async () => {};
	let features: Feature[] = [];
	let bbox = '';
	let taken = false;
	let arrived = () => {};
	const held = new Promise<void>((resolve) => (arrived = resolve));
	// times: 1 は使わない(使い終わった経路を外すときに、ほかの経路で止めている要求まで流れることがあった)
	const handler = async (route: Route) => {
		if (taken) return route.fallback();
		taken = true;
		bbox = new URL(route.request().url()).searchParams.get('bbox') ?? '';
		if (at === 'answered') {
			const response = await route.fetch();
			features = (await response.json()).features;
			release = () => route.fulfill({ response });
		} else release = () => route.continue();
		arrived();
	};
	await page.route(isSearch, handler);
	return {
		held,
		release: async () => {
			await release();
			await page.unroute(isSearch, handler);
		},
		features: () => features,
		bbox: () => bbox
	};
}

const listing = (page: Page) =>
	page.locator('[data-search]').evaluate((l) => ({
		state: l.getAttribute('data-search'),
		area: l.getAttribute('data-search-area'),
		bounds: document.querySelector('.maplibregl-map')?.getAttribute('data-bounds') ?? null,
		hits: [...l.querySelectorAll('li')].map((li) => ({
			city: li.getAttribute('data-hit-city'),
			public: li.getAttribute('data-hit-public') === 'true'
		}))
	}));

/** 一覧が、今見えている範囲の検索の結果になるまで待つ。 */
async function settled(page: Page) {
	await expect
		.poll(
			async () => {
				const l = await listing(page);
				return l.state === '見つかった' && l.area === l.bounds ? 'ok' : JSON.stringify(l);
			},
			{ timeout: 10_000 }
		)
		.toBe('ok');
	return listing(page);
}

const zoomIn = async (page: Page) => {
	await page.locator('.maplibregl-ctrl-zoom-in').click();
};

/** 止めていた応答を返し、画面が受け取るまで待つ。 */
async function deliver(page: Page, hold: Awaited<ReturnType<typeof holdNextSearch>>, status = 200) {
	const arrived = page.waitForResponse((r) => isSearch(new URL(r.url())) && r.status() === status);
	await hold.release();
	await arrived;
	await page.waitForTimeout(300);
}

test('P13 応答の追い越し(ブラウザ): 先に送った検索の応答があとから届いても、一覧は今見えている範囲のまま', async () => {
	const page = await newPage();
	const app = await open(page);
	await app.login('admin');
	await settled(page);

	const older = await holdNextSearch(page, 'answered');
	await zoomIn(page);
	await older.held;
	await page.waitForTimeout(500);
	await zoomIn(page);
	const latest = await settled(page);
	expect(older.bbox(), '止めた検索は、前の範囲のもの').not.toBe(
		JSON.parse(latest.bounds!).flat().join(',')
	);

	await deliver(page, older);
	expect(await listing(page)).toEqual(latest);
	await page.close();
});

test('P13 前の本人への応答(ブラウザ): 管理者の検索の応答が、ログアウトして閲覧者でログインし直したあとに届いても、閲覧者の一覧に非公開の地物は出ない', async () => {
	const page = await newPage();
	const app = await open(page);
	await app.login('admin');
	await settled(page);

	const adminSearch = await holdNextSearch(page, 'answered');
	await zoomIn(page);
	await adminSearch.held;
	expect(
		adminSearch.features().some((f) => !f.properties.public),
		'止めた応答には、管理者にしか見えない非公開の地物が入っている'
	).toBe(true);

	await app.press('ログアウト');
	await app.reached('未ログイン');
	await app.login('viewer');
	await settled(page);
	// 閲覧者も2つ目の検索を待っている間に、管理者の応答を届ける。番号をセッションごとに 0 から振る実装なら、
	// 管理者の2つ目の検索と閲覧者の2つ目の検索は同じ番号になり、管理者への応答を閲覧者の一覧に出してしまう
	const viewerSearch = await holdNextSearch(page, 'unsent');
	await zoomIn(page);
	await viewerSearch.held;

	await deliver(page, adminSearch);
	const meanwhile = await listing(page);
	expect(
		meanwhile.hits.every((h) => h.public),
		'閲覧者の一覧に、管理者への応答の非公開の地物が出ていない'
	).toBe(true);
	expect(meanwhile.state, '閲覧者の検索はまだ届いていない').toBe('検索中');

	await deliver(page, viewerSearch);
	expect((await settled(page)).hits.every((h) => h.public)).toBe(true);
	await page.close();
});

test('P13 前の本人の検索への 412(ブラウザ): 管理者として送った検索が、閲覧者でログインし直したあとにサーバーに届いて 412 になっても、閲覧者の画面は止めない', async () => {
	const page = await newPage();
	const app = await open(page);
	await app.login('admin');
	await settled(page);

	const adminSearch = await holdNextSearch(page, 'unsent');
	await zoomIn(page);
	await adminSearch.held;

	await app.press('ログアウト');
	await app.reached('未ログイン');
	await app.login('viewer');
	const viewers = await settled(page);

	await deliver(page, adminSearch, 412);
	await app.reached('ログイン済み/閲覧');
	expect(await page.getByText(identityChangedMessage).count()).toBe(0);
	expect(await listing(page)).toEqual(viewers);
	await page.close();
});
