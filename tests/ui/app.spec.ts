import { always, eventually, next, now } from '@antithesishq/bombadil';
import { actions, extract, getFingerprint, weighted } from '@antithesishq/bombadil/browser';
import { clicks, reload } from '@antithesishq/bombadil/browser/defaults/actions';
export {
	noUncaughtExceptions,
	noUnhandledPromiseRejections
} from '@antithesishq/bombadil/browser/defaults/properties';

const panel = extract((s) => {
	const p = s.document.querySelector('[data-app]');
	return p
		? {
				app: p.getAttribute('data-app'),
				screen: p.getAttribute('data-screen'),
				role: p.getAttribute('data-role'),
				key: p.getAttribute('data-draft-key'),
				points: Number(p.getAttribute('data-draft-points') ?? 0),
				buttons: [...p.querySelectorAll('button')].map((b) => ({
					text: b.textContent?.trim() ?? '',
					disabled: b.matches(':disabled')
				})),
				citySelectEnabled: p.querySelector('select:enabled') !== null,
				identityChanged: p.textContent?.includes('別の利用者としてログインした') ?? false
			}
		: null;
});

const popup = extract((s) => {
	const dl = s.document.querySelector('.maplibregl-popup dl');
	if (!dl) return null;
	const values = [...dl.querySelectorAll('dd')].map((d) => d.textContent ?? '');
	return Object.fromEntries(
		[...dl.querySelectorAll('dt')].map((d, i) => [d.textContent ?? '', values[i]])
	);
});

const enabledButtons = extract((s) =>
	[...s.document.querySelectorAll('button')]
		.filter((b) => !b.matches(':disabled') && b.getBoundingClientRect().width > 0)
		.map((b) => {
			const r = b.getBoundingClientRect();
			return {
				text: b.textContent?.trim() ?? '',
				fingerprint: getFingerprint(b),
				point: { x: r.left + r.width / 2, y: r.top + r.height / 2 }
			};
		})
);

const map = extract((s) => {
	const c = s.document.querySelector('canvas.maplibregl-canvas');
	const r = c?.getBoundingClientRect();
	return c && r && r.width > 400
		? {
				fingerprint: getFingerprint(c),
				x: [r.left + 320, r.right - 60] as [number, number],
				y: [r.top + 40, r.bottom - 40] as [number, number]
			}
		: null;
});

const saving = () => panel.current?.screen === '保存中' || panel.current?.screen === '再送中';
const busy = () =>
	['保存中', '再送中', '読込中', '更新中'].includes(panel.current?.screen ?? '') &&
	panel.current?.app === 'ログイン済み';
const role = () => panel.current?.role ?? null;
const enabled = (text: string) =>
	panel.current?.buttons.some((b) => b.text.startsWith(text) && !b.disabled) ?? false;

const press = (text: string) =>
	actions(() =>
		enabledButtons.current
			.filter((b) => b.text.startsWith(text))
			.map(({ fingerprint, point }) => ({ Click: { fingerprint, point } }))
	);
const clickMap = actions(() =>
	map.current
		? [
				{
					Click: {
						fingerprint: map.current.fingerprint,
						point: { x: map.current.x, y: map.current.y }
					}
				}
			]
		: []
);

export const explore = weighted([
	[8, clickMap],
	[6, press('確定して保存')],
	[4, press('ポリゴンを描く')],
	[3, press('再送する')],
	[8, press('編集を始める')],
	[8, press('保存する')],
	[2, press('読み直す')],
	[1, press('やめる')],
	[1, press('取消')],
	[3, clicks],
	[1, reload.when(() => !busy())],
	[1, actions(() => ['Wait' as const])]
]);

export const L1_応答待ちはいつか終わる = always(
	now(busy).implies(eventually(() => !busy()).within(15, 'seconds'))
);

export const P6_保存中は新しい描画が始まらない = always(() => {
	if (!saving()) return true;
	const key = panel.current?.key;
	return next(() => !panel.current?.key || panel.current.key === key);
});

export const P10_結果不明の下書きは同じキー同じ形でしか送られない = always(() => {
	const p = panel.current;
	if (p?.screen !== '結果不明') return true;
	return next(
		() => !panel.current?.key || (panel.current.key === p.key && panel.current.points === p.points)
	);
});

export const 応答待ちではログアウトできない = always(
	() =>
		!busy() ||
		panel.current?.buttons.find((b) => b.text.startsWith('ログアウト'))?.disabled === true
);

export const 競合では読み直すかやめるしか選べない = always(
	() =>
		panel.current?.app !== 'ログイン済み' ||
		panel.current.screen !== '競合' ||
		panel.current.buttons.map((b) => b.text).join('/') === 'ログアウト/読み直す/やめる'
);

export const 更新結果不明では再送するかやめるしか選べない = always(
	() =>
		panel.current?.app !== 'ログイン済み' ||
		panel.current.screen !== '更新結果不明' ||
		panel.current.buttons.map((b) => b.text).join('/') === 'ログアウト/再送する/やめる'
);

export const 結果不明では再送するかやめるしか選べない = always(
	() =>
		panel.current?.app !== 'ログイン済み' ||
		panel.current.screen !== '結果不明' ||
		panel.current.buttons.map((b) => b.text).join('/') === 'ログアウト/再送する/やめる'
);

export const ログアウト中は何も押せない = always(
	() => panel.current?.app !== 'ログアウト中' || panel.current.buttons.every((b) => b.disabled)
);

export const 閲覧者は描けない = always(() => role() !== 'viewer' || !enabled('ポリゴンを描く'));

export const 市を選べるのは管理者だけ = always(
	() => role() === 'admin' || !panel.current?.citySelectEnabled
);

const cityOfStaff: Record<string, string> = { 'a-staff': 'A', 'b-staff': 'B' };

export const P1_市職員には自分の市の地物だけが出る = always(() => {
	const city = cityOfStaff[role() ?? ''];
	return !city || !popup.current || popup.current['市'] === city;
});

export const P2_P7_閲覧者には公開の地物だけが出て所有者名は出ない = always(
	() =>
		role() !== 'viewer' ||
		!popup.current ||
		(!('所有者名' in popup.current) && popup.current['公開'] === 'true')
);
