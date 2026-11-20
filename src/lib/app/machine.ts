import type { City, Me } from '#lib/server/authz/index.ts';

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

export type Event =
	| { type: 'ログインを押す'; email: string }
	| { type: 'ログイン成功'; me: Me }
	| { type: 'ログイン失敗'; message: string }
	| { type: 'ログアウトを押す' }
	| { type: 'ログアウト完了' }
	| { type: 'ログアウト失敗' }
	| { type: '地図をクリック'; at: Point; feature: Record<string, unknown> | null }
	| { type: 'ポップアップを閉じる' }
	| { type: '描画開始'; key: string }
	| { type: '市を選ぶ'; city: City }
	| { type: '公開を選ぶ'; public: boolean }
	| { type: '確定' }
	| { type: '取消' }
	| { type: '再送' }
	| { type: '保存成功' }
	| { type: '保存失敗' }
	| { type: '保存結果不明' };

export type Effect =
	| { type: 'ログインする'; email: string }
	| { type: 'ログアウトする' }
	| { type: '保存する'; draft: Draft };

export type Step = { state: State; effects: Effect[] };

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

const stay = (state: State): Step => ({ state, effects: [] });

export function next(s: State, e: Event): Step {
	switch (s.kind) {
		case '未ログイン':
			if (e.type === 'ログインを押す')
				return {
					state: { kind: 'ログイン中', email: e.email },
					effects: [{ type: 'ログインする', email: e.email }]
				};
			return stay(s);
		case 'ログイン中':
			if (e.type === 'ログイン成功') return stay(loggedIn(e.me));
			if (e.type === 'ログイン失敗') return stay({ kind: '未ログイン', error: e.message });
			return stay(s);
		case 'ログアウト中':
			if (e.type === 'ログアウト完了') return stay({ kind: '未ログイン', error: null });
			if (e.type === 'ログアウト失敗') return stay(s.from);
			return stay(s);
		case 'ログイン済み':
			if (e.type === 'ログアウトを押す' && !saving(s.screen))
				return { state: { kind: 'ログアウト中', from: s }, effects: [{ type: 'ログアウトする' }] };
			return onScreen(s, e);
	}
}

function onScreen(s: LoggedIn, e: Event): Step {
	const to = (screen: Screen, effects: Effect[] = [], tiles = s.tiles): Step => ({
		state: { ...s, screen, tiles },
		effects
	});
	const v = s.screen;
	switch (v.kind) {
		case '閲覧':
			if (e.type === '地図をクリック')
				return to({ kind: '閲覧', selected: e.feature && { at: e.at, properties: e.feature } });
			if (e.type === 'ポップアップを閉じる') return to({ kind: '閲覧', selected: null });
			if (e.type === '描画開始' && s.me.canEdit)
				return to({
					kind: '描画中',
					draft: { key: e.key, city: homeCity(s.me), public: false, points: [] },
					notice: null
				});
			return stay(s);
		case '描画中': {
			const d = v.draft;
			if (e.type === '地図をクリック')
				return to({ ...v, draft: { ...d, points: [...d.points, e.at] } });
			if (e.type === '市を選ぶ' && s.me.role === 'admin')
				return to({ ...v, draft: { ...d, city: e.city } });
			if (e.type === '公開を選ぶ') return to({ ...v, draft: { ...d, public: e.public } });
			if (e.type === '確定' && d.points.length >= 3)
				return to({ kind: '保存中', draft: d }, [{ type: '保存する', draft: d }]);
			if (e.type === '取消') return to({ kind: '閲覧', selected: null });
			return stay(s);
		}
		case '保存中':
		case '再送中':
			if (e.type === '保存成功') return to({ kind: '閲覧', selected: null }, [], s.tiles + 1);
			if (e.type === '保存結果不明') return to({ kind: '結果不明', draft: v.draft, notice: null });
			if (e.type === '保存失敗')
				return to(
					v.kind === '保存中'
						? { kind: '描画中', draft: v.draft, notice: '保存失敗' }
						: { kind: '結果不明', draft: v.draft, notice: '再送失敗' }
				);
			return stay(s);
		case '結果不明':
			if (e.type === '再送')
				return to({ kind: '再送中', draft: v.draft }, [{ type: '保存する', draft: v.draft }]);
			if (e.type === '取消') return to({ kind: '閲覧', selected: null }, [], s.tiles + 1);
			return stay(s);
	}
}
