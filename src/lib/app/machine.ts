import type { City, Me } from '#lib/domain.ts';

export type Point = [lng: number, lat: number];
export type Draft = { key: string; city: City; public: boolean; points: Point[] };
export type Selected = { at: Point; properties: Record<string, unknown> };

export type Screen =
	| { kind: '閲覧'; selected: Selected | null }
	| { kind: '描画中'; draft: Draft; notice: '保存失敗' | null }
	| { kind: '保存中'; draft: Draft }
	| { kind: '結果不明'; draft: Draft; notice: '再送失敗' | null }
	| { kind: '再送中'; draft: Draft };

export type LoggedIn = { kind: 'ログイン済み'; me: Me; tiles: number; screen: Screen };

export type State =
	| { kind: '未ログイン'; error: string | null }
	| { kind: 'ログイン中'; email: string }
	| LoggedIn
	| { kind: 'ログアウト中'; from: LoggedIn };

export type Op =
	| { type: 'ログインを押す'; email: string }
	| { type: 'ログアウトを押す' }
	| { type: '地図をクリック'; at: Point; feature: Record<string, unknown> | null }
	| { type: 'ポップアップを閉じる' }
	| { type: '描画開始'; key: string }
	| { type: '市を選ぶ'; city: City }
	| { type: '公開を選ぶ'; public: boolean }
	| { type: '確定' }
	| { type: '取消' }
	| { type: '再送' };

export type Reply =
	| { type: 'ログイン成功'; me: Me }
	| { type: 'ログイン失敗'; message: string }
	| { type: 'ログアウト完了' }
	| { type: 'ログアウト失敗' }
	| { type: '保存成功' }
	| { type: '保存失敗' }
	| { type: '保存結果不明' }
	| { type: '本人が変わった' };

export type Notice = { type: '地図の本人が変わった' };

export type Effect =
	| { type: 'ログインする'; email: string }
	| { type: 'ログアウトする' }
	| { type: '保存する'; draft: Draft; as: string };

export type Step = { state: State; effects: Effect[] };

export type OpOf<T extends Op['type']> = Extract<Op, { type: T }>;
export type Offers = { [T in Op['type']]?: (op: OpOf<T>) => Step };

export const init = (me: Me | null): State =>
	me ? loggedIn(me) : { kind: '未ログイン', error: null };

const loggedIn = (me: Me): LoggedIn => ({
	kind: 'ログイン済み',
	me,
	tiles: 0,
	screen: { kind: '閲覧', selected: null }
});

const homeCity = (me: Me): City => (me.role === 'b-staff' ? 'B' : 'A');

export const saving = (v: Screen): v is Extract<Screen, { kind: '保存中' | '再送中' }> =>
	v.kind === '保存中' || v.kind === '再送中';

const only = (state: State): Step => ({ state, effects: [] });

export function offers(s: State): Offers {
	switch (s.kind) {
		case '未ログイン':
			return {
				ログインを押す: (e) => ({
					state: { kind: 'ログイン中', email: e.email },
					effects: [{ type: 'ログインする', email: e.email }]
				})
			};
		case 'ログイン中':
		case 'ログアウト中':
			return {};
		case 'ログイン済み':
			return {
				...onScreen(s),
				ログアウトを押す: saving(s.screen)
					? undefined
					: () => ({
							state: { kind: 'ログアウト中', from: s },
							effects: [{ type: 'ログアウトする' }]
						})
			};
	}
}

function onScreen(s: LoggedIn): Offers {
	const to = (screen: Screen, effects: Effect[] = []): Step => ({
		state: { ...s, screen },
		effects
	});
	const refreshed = (screen: Screen): Step => only({ ...s, tiles: s.tiles + 1, screen });
	const v = s.screen;
	switch (v.kind) {
		case '閲覧':
			return {
				地図をクリック: (e) =>
					to({ kind: '閲覧', selected: e.feature && { at: e.at, properties: e.feature } }),
				ポップアップを閉じる: v.selected ? () => to({ kind: '閲覧', selected: null }) : undefined,
				描画開始: s.me.canEdit
					? (e) =>
							to({
								kind: '描画中',
								draft: { key: e.key, city: homeCity(s.me), public: false, points: [] },
								notice: null
							})
					: undefined
			};
		case '描画中': {
			const d = v.draft;
			return {
				地図をクリック: (e) => to({ ...v, draft: { ...d, points: [...d.points, e.at] } }),
				市を選ぶ:
					s.me.role === 'admin' ? (e) => to({ ...v, draft: { ...d, city: e.city } }) : undefined,
				公開を選ぶ: (e) => to({ ...v, draft: { ...d, public: e.public } }),
				確定:
					d.points.length >= 3
						? () => to({ kind: '保存中', draft: d }, [{ type: '保存する', draft: d, as: s.me.id }])
						: undefined,
				取消: () => to({ kind: '閲覧', selected: null })
			};
		}
		case '結果不明':
			return {
				再送: () =>
					to({ kind: '再送中', draft: v.draft }, [
						{ type: '保存する', draft: v.draft, as: s.me.id }
					]),
				取消: () => refreshed({ kind: '閲覧', selected: null })
			};
		case '保存中':
		case '再送中':
			return {};
	}
}

export const perform = (offered: Offers, op: Op): Step | undefined =>
	(offered[op.type] as ((op: Op) => Step) | undefined)?.(op);

export function receive(s: State, r: Reply): Step | undefined {
	switch (s.kind) {
		case 'ログイン中':
			if (r.type === 'ログイン成功') return only(loggedIn(r.me));
			if (r.type === 'ログイン失敗') return only({ kind: '未ログイン', error: r.message });
			return undefined;
		case 'ログアウト中':
			if (r.type === 'ログアウト完了') return only({ kind: '未ログイン', error: null });
			if (r.type === 'ログアウト失敗') return only(s.from);
			return undefined;
		case 'ログイン済み':
			return onReply(s, r);
		case '未ログイン':
			return undefined;
	}
}

function onReply(s: LoggedIn, r: Reply): Step | undefined {
	const v = s.screen;
	if (!saving(v)) return undefined;
	switch (r.type) {
		case '保存成功':
			return only({ ...s, tiles: s.tiles + 1, screen: { kind: '閲覧', selected: null } });
		case '保存結果不明':
			return only({ ...s, screen: { kind: '結果不明', draft: v.draft, notice: null } });
		case '保存失敗':
			return only({
				...s,
				screen:
					v.kind === '保存中'
						? { kind: '描画中', draft: v.draft, notice: '保存失敗' }
						: { kind: '結果不明', draft: v.draft, notice: '再送失敗' }
			});
		case '本人が変わった':
			return only({ kind: '未ログイン', error: identityChangedMessage });
		default:
			return undefined;
	}
}

export const identityChangedMessage =
	'ほかの画面で別の利用者としてログインしたため、この画面での操作を止めました。もう一度ログインしてください';

export function notify(s: State, n: Notice): Step {
	switch (n.type) {
		case '地図の本人が変わった':
			return s.kind === 'ログイン済み' && !saving(s.screen)
				? only({ kind: '未ログイン', error: identityChangedMessage })
				: only(s);
	}
}
