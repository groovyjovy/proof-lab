import type { Browser, Page, Route } from 'playwright-core';
import { seedBoundary, seedFeatures, seedUsers } from '../db/seed.ts';

export type Role = (typeof seedUsers)[number]['user'];
export const roles = seedUsers.map((u) => u.user);
export const userOf = (role: Role) => seedUsers.find((u) => u.user === role)!;

const viewport = { width: 1280, height: 800 };
const center: [number, number] = [141.35, 43.05];
const zoom = 12;
const panelRight = 320;
const triangle: [number, number][] = [
	[500, 300],
	[700, 300],
	[600, 500]
];

const mercator = ([lng, lat]: [number, number]) => {
	const size = 512 * 2 ** zoom;
	const r = (lat * Math.PI) / 180;
	return [
		((lng + 180) / 360) * size,
		((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * size
	];
};

export function pixelOf(at: [number, number]) {
	const [x, y] = mercator(at);
	const [cx, cy] = mercator(center);
	return { x: x - cx + viewport.width / 2, y: y - cy + viewport.height / 2 };
}

export function clickBoundarySide(page: Page, side: 'west' | 'east') {
	const west = side === 'west';
	const { x, y } = pixelOf([
		seedBoundary.center + (west ? -0.009 : 0.009),
		west ? seedBoundary.south + 0.003 : seedBoundary.north - 0.003
	]);
	return page.mouse.click(x, y);
}

/** パネルや拡大縮小のボタンに隠れない、地図の上にある点の地物 */
const onScreen = (f: (typeof seedFeatures)[number]) => {
	if (f.geometry.type !== 'Point') return false;
	const { x, y } = pixelOf(f.geometry.coordinates as [number, number]);
	return x > panelRight && x < viewport.width - 80 && y > 120 && y < 760;
};

const visibleTo = (role: Role) => (f: (typeof seedFeatures)[number]) =>
	role === 'admin' ||
	(role === 'viewer' ? f.public : f.city === { 'a-staff': 'A', 'b-staff': 'B' }[role]);

/** ハイドレーションが終わるまで、画面は操作を差し出さない(ボタンは押せない)。押せるボタンが出るまで待つ。 */
export async function open(page: Page) {
	await page.goto('/');
	await page.locator('[data-app] button:enabled').first().waitFor();
	return driver(page);
}

export async function openApp(browser: Browser, baseURL: string) {
	return open(await browser.newPage({ baseURL, viewport }));
}

export type App = ReturnType<typeof driver>;

export const driver = (page: Page) => {
	const root = page.locator('[data-app]');
	const editUser = async (target: Role, endpoint: string, data: object) => {
		const headers = { origin: new URL(page.url()).origin };
		const { users } = await (await page.request.get('/api/auth/admin/list-users')).json();
		const user = users.find((u: { email: string }) => u.email === userOf(target).email);
		const res = await page.request.post(`/api/auth/admin/${endpoint}`, {
			headers,
			data: { userId: user.id, ...data }
		});
		return res.status();
	};
	const app = {
		page,
		kind: async () => {
			const screen = await root.getAttribute('data-screen');
			const kind = await root.getAttribute('data-app');
			return screen ? `${kind}/${screen}` : kind;
		},
		reached: (kind: string) => {
			const [a, s] = kind.split('/');
			return page.locator(`[data-app="${a}"]${s ? `[data-screen="${s}"]` : ''}`).waitFor();
		},
		header: () => page.locator('section[data-app] span').first().textContent(),
		draftKey: () => root.getAttribute('data-draft-key'),
		press: (name: string) => page.getByRole('button', { name, exact: true }).click(),

		async login(role: Role) {
			await app.press(userOf(role).name);
			await app.reached('ログイン済み/閲覧');
		},

		async drawTriangle() {
			await app.press('ポリゴンを描く');
			await page.locator('canvas.maplibregl-canvas').waitFor();
			for (const [i, [x, y]] of triangle.entries()) {
				await page.mouse.click(x, y);
				await page.locator(`[data-draft-points="${i + 1}"]`).waitFor();
			}
			return (await app.draftKey()) ?? '';
		},

		/** ボタンを押し、それで飛んだ地物の書き込み(作成は POST、更新は PUT)の応答の状態コードを返す。 */
		async save(button = '確定して保存') {
			const response = page.waitForResponse(
				(r) =>
					new URL(r.url()).pathname.startsWith('/api/features') &&
					['POST', 'PUT'].includes(r.request().method())
			);
			await app.press(button);
			return (await response).status();
		},

		fill: (label: string, value: string) => page.getByLabel(label).fill(value),

		async openPopup(role: Role) {
			const target = seedFeatures.find(
				(f) => f.geometry.type === 'Point' && visibleTo(role)(f) && onScreen(f)
			);
			if (!target) throw new Error(`${role} に見える点の地物が画面の中にない`);
			await app.openFeature(target.id);
		},

		/** シードの点の地物をクリックして、ポップアップを開く。 */
		async openFeature(id: number) {
			const f = seedFeatures.find((f) => f.id === id && f.geometry.type === 'Point');
			if (!f || !onScreen(f)) throw new Error(`地物 ${id} は画面の中の点ではない`);
			const target = pixelOf(f.geometry.coordinates as [number, number]);
			const popup = page.locator('.maplibregl-popup');
			for (let i = 0; i < 10 && !(await popup.count()); i++) {
				await page.mouse.click(target.x, target.y);
				await popup.waitFor({ timeout: 1000 }).catch(() => {});
			}
			await popup.waitFor();
		},

		revokeEditPermission: (target: Role) =>
			editUser(target, 'update-user', { data: { canEdit: false } }),
		setRole: (target: Role, role: Role) => editUser(target, 'set-role', { role }),

		hold: (path: string | RegExp, method = 'POST') => hold(page, path, method),

		/** 地図と一覧が落ち着くまで待つ。変更の流れ(P14)はつながったままなので、通信が止まる
		    (networkidle)のは待てない。一覧の検索が終わるのを待ち、タイルの描画を少し待つ。 */
		async settle() {
			await page
				.locator('[data-search]:not([data-search="検索中"])')
				.first()
				.waitFor({ timeout: 5_000 })
				.catch(() => {});
			await page.waitForTimeout(800);
		}
	};
	return app;
};

/** そのパス(文字列ならちょうど、正規表現なら一致)とメソッドの要求を、release するまで止める。 */
async function hold(page: Page, path: string | RegExp, method: string) {
	const pattern = (url: URL) =>
		typeof path === 'string' ? url.pathname === path : path.test(url.pathname);
	let arrived: (route: Route) => void = () => {};
	const arrival = new Promise<Route>((r) => (arrived = r));
	await page.route(pattern, (route) =>
		route.request().method() === method ? arrived(route) : route.continue()
	);
	return {
		async release(status?: number) {
			const route = await arrival;
			if (status === undefined) await route.continue();
			else await route.fulfill({ status, contentType: 'application/json', body: '{}' });
			await page.unroute(pattern);
		}
	};
}
