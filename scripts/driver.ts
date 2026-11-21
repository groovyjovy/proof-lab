import type { Browser, Page, Route } from 'playwright-core';
import { seedFeatures, seedUsers } from '../db/seed.ts';

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

const visibleTo = (role: Role) => (f: (typeof seedFeatures)[number]) =>
	role === 'admin' ||
	(role === 'viewer' ? f.public : f.city === { 'a-staff': 'A', 'b-staff': 'B' }[role]);

/** サーバーが描いた HTML のボタンは、ハイドレーションが終わるまで反応しない。終わったら body に印が付く。 */
export async function open(page: Page) {
	await page.goto('/');
	await page.locator('body[data-hydrated]').waitFor({ state: 'attached' });
	return driver(page);
}

export async function openApp(browser: Browser, baseURL: string) {
	return open(await browser.newPage({ baseURL, viewport }));
}

export type App = ReturnType<typeof driver>;

export const driver = (page: Page) => {
	const root = page.locator('[data-app]');
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

		async save(button = '確定して保存') {
			const response = page.waitForResponse(
				(r) => new URL(r.url()).pathname === '/api/features' && r.request().method() === 'POST'
			);
			await app.press(button);
			return (await response).status();
		},

		async openPopup(role: Role) {
			const target = seedFeatures
				.filter((f) => f.geometry.type === 'Point' && visibleTo(role)(f))
				.map((f) => pixelOf(f.geometry.coordinates as [number, number]))
				.find(({ x, y }) => x > panelRight && x < viewport.width - 80 && y > 120 && y < 760);
			if (!target) throw new Error(`${role} に見える点の地物が画面の中にない`);
			const popup = page.locator('.maplibregl-popup');
			for (let i = 0; i < 10 && !(await popup.count()); i++) {
				await page.mouse.click(target.x, target.y);
				await popup.waitFor({ timeout: 1000 }).catch(() => {});
			}
			await popup.waitFor();
		},

		async revokeEditPermission(target: Role) {
			const headers = { origin: new URL(page.url()).origin };
			const { users } = await (await page.request.get('/api/auth/admin/list-users')).json();
			const user = users.find((u: { email: string }) => u.email === userOf(target).email);
			const res = await page.request.post('/api/auth/admin/update-user', {
				headers,
				data: { userId: user.id, data: { canEdit: false } }
			});
			return res.status();
		},

		hold: (path: string) => hold(page, path),

		async settle() {
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForTimeout(500);
		}
	};
	return app;
};

async function hold(page: Page, path: string) {
	const pattern = (url: URL) => url.pathname === path;
	let arrived: (route: Route) => void = () => {};
	const arrival = new Promise<Route>((r) => (arrived = r));
	await page.route(pattern, (route) =>
		route.request().method() === 'POST' ? arrived(route) : route.continue()
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
