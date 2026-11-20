import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';
import { restoreSeed } from '../db/seed.ts';
import { stateDiagram } from '../model/state-diagram.ts';
import { startDevServer } from './dev-server.ts';
import { openApp, roles, userOf, type App, type Role } from './driver.ts';

const origin = 'http://localhost:5196';

type Context = { browser: Browser; app: App; role: Role; shot: (note?: string) => Promise<void> };

const loginShowingProgress = async ({ app, role, shot }: Context) => {
	await shot();
	const signIn = await app.hold('/api/auth/sign-in/email');
	await app.press(userOf(role).name);
	await app.reached('ログイン中');
	await shot();
	await signIn.release();
	await app.reached('ログイン済み/閲覧');
	await app.settle();
	await shot();
};

const logoutFailing = async ({ app, shot }: Context) => {
	const back = await app.kind();
	const signOut = await app.hold('/api/auth/sign-out');
	await app.press('ログアウト');
	await app.reached(`ログアウト中/${back?.split('/')[1]}`);
	await shot();
	await signOut.release(500);
	await app.reached(back ?? '');
};

const saveAnswered = async ({ app, shot }: Context, button: string, status?: number) => {
	const save = await app.hold('/api/features');
	await app.press(button);
	await app.reached(button === '再送する' ? 'ログイン済み/再送中' : 'ログイン済み/保存中');
	await shot();
	await save.release(status);
};

const scenarios: Record<string, { draws: boolean; run: (c: Context) => Promise<void> }> = {
	login: { draws: false, run: loginShowingProgress },
	popup: {
		draws: false,
		async run(c) {
			await c.app.login(c.role);
			await c.app.settle();
			await c.app.openPopup(c.role);
			await c.shot('ポップアップ');
		}
	},
	'draw-and-save': {
		draws: true,
		async run(c) {
			await c.app.login(c.role);
			await c.app.settle();
			await c.app.drawTriangle();
			await c.shot();
			await saveAnswered(c, '確定して保存');
			await c.app.reached('ログイン済み/閲覧');
			await c.app.settle();
			await c.shot('保存した');
		}
	},
	'revoke-then-save': {
		draws: true,
		async run(c) {
			await c.app.login(c.role);
			await c.app.settle();
			await c.app.drawTriangle();
			await c.shot();
			const admin = await openApp(c.browser, origin);
			await admin.login('admin');
			console.log('管理者が編集権限を剥奪した:', await admin.revokeEditPermission(c.role));
			console.log('剥奪後の保存:', await c.app.save());
			await c.app.page.getByText('保存できませんでした').waitFor();
			await c.shot('保存失敗');
			await c.app.page.reload();
			await c.app.reached('ログイン済み/閲覧');
			await c.shot('再読み込み後');
		}
	},
	tour: {
		draws: true,
		async run(c) {
			const { app, shot } = c;
			await loginShowingProgress(c);
			await app.openPopup(c.role);
			await shot('ポップアップ');
			await logoutFailing(c);
			await app.drawTriangle();
			await shot();
			await logoutFailing(c);
			await saveAnswered(c, '確定して保存', 409);
			await app.page.getByText('保存できませんでした').waitFor();
			await shot('保存失敗');
			await saveAnswered(c, '確定して保存', 504);
			await app.reached('ログイン済み/結果不明');
			await shot();
			await logoutFailing(c);
			await saveAnswered(c, '再送する', 409);
			await app.page.getByText('再送できませんでした').waitFor();
			await shot('再送失敗');
			await saveAnswered(c, '再送する');
			await app.reached('ログイン済み/閲覧');
			await app.settle();
			await shot('保存した');
		}
	}
};

const { values } = parseArgs({
	options: {
		role: { type: 'string', default: 'a-staff' },
		scenario: { type: 'string', default: '' },
		screenshot: { type: 'boolean', default: false }
	}
});
const role = values.role as Role;
const scenario = scenarios[values.scenario];
if (!roles.includes(role) || !scenario)
	throw new Error(
		`使い方: pnpm drive --role <${roles.join('|')}> --scenario <${Object.keys(scenarios).join('|')}> [--screenshot]`
	);
if (scenario.draws && !userOf(role).canEdit)
	throw new Error(`${role} は描けない(描画ボタンが出ない)ので、${values.scenario} は流せない`);

const command = `pnpm drive --role ${role} --scenario ${values.scenario}${values.screenshot ? ' --screenshot' : ''}`;
const out = join(
	'evidence',
	`${new Date().toLocaleString('sv-SE').replace(' ', 'T').replaceAll(':', '-')}-${role}-${values.scenario}`
);
if (values.screenshot) await mkdir(out, { recursive: true });

const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
await db.connect();
await restoreSeed(db);
const stopServer = await startDevServer(origin, { quiet: true });
const browser = await chromium.launch({ channel: 'chrome' });
const shots: { kind: string; note: string; file?: string }[] = [];

try {
	const app = await openApp(browser, origin);
	const shot = async (note = '') => {
		const kind = (await app.kind()) ?? '';
		const label = note ? `${kind}(${note})` : kind;
		const file = values.screenshot
			? `${String(shots.length + 1).padStart(2, '0')}-${label.replaceAll('/', '-')}.png`
			: undefined;
		if (file) await app.page.screenshot({ path: join(out, file) });
		shots.push({ kind, note, file });
		console.log(String(shots.length).padStart(2, '0'), label, file ? join(out, file) : '');
	};
	await scenario.run({ browser, app, role, shot });

	const diagram = stateDiagram();
	const missed = diagram.kinds.filter((k) => !shots.some((s) => s.kind === k));
	if (values.scenario === 'tour' && missed.length) {
		console.log('撮れなかった状態:', missed);
		process.exitCode = 1;
	}
	if (values.screenshot) {
		await writeFile(
			join(out, 'README.md'),
			[
				`# ${values.scenario}(${role})`,
				'',
				`\`${command}\` で ${new Date().toLocaleString('ja-JP')} に撮った。`,
				...(values.scenario === 'tour'
					? [
							'',
							'## 状態図',
							'',
							'モデル3が全探索でたどった遷移から作った(`model/state-diagram.ts`)。下の画面が、図の状態を全部通っているかを見る。',
							'',
							'```mermaid',
							diagram.mermaid,
							'```',
							'',
							missed.length ? `撮れなかった状態: ${missed.join('、')}` : '図の状態は全部撮れた。'
						]
					: []),
				'',
				'## 画面',
				'',
				'| # | 状態 | 画面 |',
				'|---|---|---|',
				...shots.map(
					(s, i) =>
						`| ${i + 1} | ${s.kind}${s.note ? `(${s.note})` : ''} | ![](${encodeURI(s.file ?? '')}) |`
				),
				''
			].join('\n')
		);
		console.log('記録:', join(out, 'README.md'));
	}
} finally {
	await browser.close();
	stopServer();
	await restoreSeed(db);
	await db.end();
}
