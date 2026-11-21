import { canWrite, type City, type Me } from '#lib/domain.ts';

export type Point = [lng: number, lat: number];
export type Draft = { key: string; city: City; public: boolean; points: Point[] };
export type FeatureRef = { id: number; city: City; public: boolean };
export type Hit = { ref: FeatureRef; properties: Record<string, unknown> };
export type Selected = { at: Point } & Hit;
/** 編集中の値。版は、サーバーから読み込んだときのもの(P4)。 */
export type Edit = { ref: FeatureRef; version: number; name: string; note: string };

export type Screen =
	| { kind: '閲覧'; selected: Selected | null }
	| { kind: '描画中'; draft: Draft; notice: '保存失敗' | null }
	| { kind: '保存中'; draft: Draft }
	| { kind: '結果不明'; draft: Draft; notice: '再送失敗' | null }
	| { kind: '再送中'; draft: Draft }
	| { kind: '読込中'; ref: FeatureRef }
	| { kind: '編集中'; edit: Edit; notice: '更新失敗' | null }
	| { kind: '更新中'; edit: Edit; key: string }
	| { kind: '更新結果不明'; edit: Edit; key: string; notice: '再送失敗' | null }
	| { kind: '競合'; edit: Edit };

/** 地図に見えている範囲(南西の角と北東の角)。 */
export type Area = [sw: Point, ne: Point];
/** 範囲の検索の要求。番号はタブの中で一度きりで、ログインし直しても振り直さない。
    検索は同時にいくつも飛び、応答は送った順に届くとは限らないので、応答には番号を書く。 */
export type Query = { seq: number; area: Area };
/** タブの地図。ログインとは関係なく続く(ログアウトしたあとも、前の本人の検索の応答は届く)。
    `issued` は、これまでに振った検索の番号の数(次に振る番号)。 */
export type MapView = { area: Area | null; issued: number };
/** 一覧に出しているもの。どの検索への応答かを持つ。 */
export type Listing =
	{ kind: '見つかった'; query: Query; hits: Hit[] } | { kind: '検索できない'; query: Query };
/** 範囲の一覧。応答を待つのは、いちばん新しい検索だけ(それより前の検索の応答は、届いても捨てる)。 */
export type Search = { pending: Query | null; shown: Listing | null };

export type LoggedIn = {
	kind: 'ログイン済み';
	me: Me;
	tiles: number;
	screen: Screen;
	map: MapView;
	search: Search;
};

/** 地図(`map`)は、どの状態にもある。ログインし直しても、検索の番号は続きから振る。 */
export type State =
	| { kind: '未ログイン'; error: string | null; map: MapView }
	| { kind: 'ログイン中'; email: string; map: MapView }
	| LoggedIn
	| { kind: 'ログアウト中'; from: LoggedIn };

export type Op =
	| { type: 'ログインを押す'; email: string }
	| { type: 'ログアウトを押す' }
	| { type: '地図をクリック'; at: Point; feature: Hit | null }
	| { type: 'ポップアップを閉じる' }
	| { type: '描画開始'; key: string }
	| { type: '市を選ぶ'; city: City }
	| { type: '公開を選ぶ'; public: boolean }
	| { type: '確定' }
	| { type: '取消' }
	| { type: '再送' }
	| { type: '編集を始める' }
	| { type: '名前を変える'; name: string }
	| { type: '備考を変える'; note: string }
	| { type: '編集を保存'; key: string }
	| { type: '読み直す' };

export type Reply =
	| { type: 'ログイン成功'; me: Me }
	| { type: 'ログイン失敗'; message: string }
	| { type: 'ログアウト完了' }
	| { type: 'ログアウト失敗' }
	| { type: '保存成功' }
	| { type: '保存失敗' }
	| { type: '保存結果不明' }
	| { type: '本人が変わった' }
	| { type: '読み込めた'; edit: Edit }
	| { type: '読み込めない' }
	| { type: '競合した' }
	| { type: '検索の応答'; seq: number; result: SearchResult };

export type SearchResult =
	{ type: '見つかった'; hits: Hit[] } | { type: '検索できない' } | { type: '本人が変わった' };

/** 副作用とは関係なく届く知らせ。どの状態でも受け取る。 */
export type Notice = { type: '地図の本人が変わった' } | { type: '地図が動いた'; area: Area };

export type Effect =
	| { type: 'ログインする'; email: string }
	| { type: 'ログアウトする' }
	| { type: '保存する'; draft: Draft; as: string }
	| { type: '読み込む'; id: number; as: string }
	| { type: '更新する'; edit: Edit; key: string; as: string }
	/** ほかの副作用と違い、応答を待たずに次の検索を送る */
	| { type: '検索する'; query: Query; as: string };

export type Step = { state: State; effects: Effect[] };

export type OpOf<T extends Op['type']> = Extract<Op, { type: T }>;
export type Offers = { [T in Op['type']]?: (op: OpOf<T>) => Step };

/** ログインした直後のセッション。一覧は空で、地図はそれまでのもの。 */
const fresh = (me: Me, map: MapView): LoggedIn => ({
	kind: 'ログイン済み',
	me,
	tiles: 0,
	screen: { kind: '閲覧', selected: null },
	map,
	search: { pending: null, shown: null }
});

/** ページを読み込んだときの状態。ページを読み込み直すと飛んでいた要求もなくなるので、番号は 0 から振る。 */
export const init = (me: Me | null): State => {
	const map: MapView = { area: null, issued: 0 };
	return me ? fresh(me, map) : { kind: '未ログイン', error: null, map };
};

const homeCity = (me: Me): City => (me.role === 'b-staff' ? 'B' : 'A');

export const saving = (v: Screen): v is Extract<Screen, { kind: '保存中' | '再送中' }> =>
	v.kind === '保存中' || v.kind === '再送中';

/** 副作用の応答を待っている。この間は、ほかの副作用を出さない(飛んでいる副作用は高々1つ)。 */
export const busy = (v: Screen) => saving(v) || v.kind === '読込中' || v.kind === '更新中';

const only = (state: State): Step => ({ state, effects: [] });

/** 今見えている範囲を検索して、画面 `screen` に移る。番号を1つ振り、応答を待つ検索をこれに替える。
    範囲がまだ分からなければ検索しない。 */
function searchTo(s: LoggedIn, screen: Screen): Step {
	const area = s.map.area;
	if (!area) return only({ ...s, screen });
	const query: Query = { seq: s.map.issued, area };
	return {
		state: {
			...s,
			screen,
			map: { ...s.map, issued: s.map.issued + 1 },
			search: { ...s.search, pending: query }
		},
		effects: [{ type: '検索する', query, as: s.me.id }]
	};
}

/** 保存が終わった(または取り消した)ので、タイルと一覧を読み直す。 */
const refreshTo = (s: LoggedIn, screen: Screen) => searchTo({ ...s, tiles: s.tiles + 1 }, screen);

export function offers(s: State): Offers {
	switch (s.kind) {
		case '未ログイン':
			return {
				ログインを押す: (e) => ({
					state: { kind: 'ログイン中', email: e.email, map: s.map },
					effects: [{ type: 'ログインする', email: e.email }]
				})
			};
		case 'ログイン中':
		case 'ログアウト中':
			return {};
		case 'ログイン済み':
			return {
				...onScreen(s),
				ログアウトを押す: busy(s.screen)
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
	const load = (ref: FeatureRef) =>
		to({ kind: '読込中', ref }, [{ type: '読み込む', id: ref.id, as: s.me.id }]);
	const update = (edit: Edit, key: string) =>
		to({ kind: '更新中', edit, key }, [{ type: '更新する', edit, key, as: s.me.id }]);
	const v = s.screen;
	switch (v.kind) {
		case '閲覧':
			return {
				地図をクリック: (e) =>
					to({ kind: '閲覧', selected: e.feature && { at: e.at, ...e.feature } }),
				ポップアップを閉じる: v.selected ? () => to({ kind: '閲覧', selected: null }) : undefined,
				編集を始める:
					v.selected && canWrite(s.me, v.selected.ref) ? () => load(v.selected!.ref) : undefined,
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
				取消: () => refreshTo(s, { kind: '閲覧', selected: null })
			};
		case '編集中': {
			const e = v.edit;
			return {
				名前を変える: (op) => to({ ...v, edit: { ...e, name: op.name } }),
				備考を変える: (op) => to({ ...v, edit: { ...e, note: op.note } }),
				編集を保存: (op) => update(e, op.key),
				取消: () => to({ kind: '閲覧', selected: null })
			};
		}
		case '更新結果不明':
			return {
				再送: () => update(v.edit, v.key),
				取消: () => refreshTo(s, { kind: '閲覧', selected: null })
			};
		case '競合':
			return {
				読み直す: () => load(v.edit.ref),
				取消: () => to({ kind: '閲覧', selected: null })
			};
		case '保存中':
		case '再送中':
		case '読込中':
		case '更新中':
			return {};
	}
}

export const perform = (offered: Offers, op: Op): Step | undefined =>
	(offered[op.type] as ((op: Op) => Step) | undefined)?.(op);

/** 応答を受け取った遷移。受け取れなければ `undefined`(app.svelte.ts は例外にする)。
    検索の応答は、どの状態でも受け取る(前のセッションで送った検索の応答も届く)。
    ログアウト中は一覧を止めておき、ログアウトに失敗したら検索し直す。 */
export function receive(s: State, r: Reply): Step | undefined {
	if (r.type === '検索の応答')
		return s.kind === 'ログイン済み' ? onSearched(s, r.seq, r.result) : only(s);
	switch (s.kind) {
		case 'ログイン中':
			if (r.type === 'ログイン成功')
				return searchTo(fresh(r.me, s.map), { kind: '閲覧', selected: null });
			if (r.type === 'ログイン失敗')
				return only({ kind: '未ログイン', error: r.message, map: s.map });
			return undefined;
		case 'ログアウト中':
			if (r.type === 'ログアウト完了')
				return only({ kind: '未ログイン', error: null, map: s.from.map });
			if (r.type === 'ログアウト失敗') return searchTo(s.from, s.from.screen);
			return undefined;
		case 'ログイン済み':
			return onReply(s, r);
		case '未ログイン':
			return undefined;
	}
}

function onReply(s: LoggedIn, r: Reply): Step | undefined {
	const v = s.screen;
	const to = (screen: Screen) => only({ ...s, screen });
	if (!busy(v)) return undefined;
	if (r.type === '本人が変わった')
		return only({ kind: '未ログイン', error: identityChangedMessage, map: s.map });
	switch (v.kind) {
		case '保存中':
		case '再送中':
			switch (r.type) {
				case '保存成功':
					return refreshTo(s, { kind: '閲覧', selected: null });
				case '保存結果不明':
					return to({ kind: '結果不明', draft: v.draft, notice: null });
				case '保存失敗':
					return to(
						v.kind === '保存中'
							? { kind: '描画中', draft: v.draft, notice: '保存失敗' }
							: { kind: '結果不明', draft: v.draft, notice: '再送失敗' }
					);
				default:
					return undefined;
			}
		case '読込中':
			switch (r.type) {
				case '読み込めた':
					return to({ kind: '編集中', edit: r.edit, notice: null });
				case '読み込めない':
					return to({ kind: '閲覧', selected: null });
				default:
					return undefined;
			}
		case '更新中':
			switch (r.type) {
				case '保存成功':
					return refreshTo(s, { kind: '閲覧', selected: null });
				case '保存結果不明':
					return to({ kind: '更新結果不明', edit: v.edit, key: v.key, notice: null });
				case '保存失敗':
					return to({ kind: '編集中', edit: v.edit, notice: '更新失敗' });
				case '競合した':
					return to({ kind: '競合', edit: v.edit });
				default:
					return undefined;
			}
	}
}

/** 検索の応答。応答を待っているいちばん新しい検索への応答だけを一覧に出し、ほかは何も変えずに捨てる。
    本人が変わったという応答も、いちばん新しい検索へのものだけを信じる(前の本人として送った検索なら、
    今の本人は変わっていない)。ほかの副作用の応答を待っている間は、その応答を捨てないようにログアウトしない。 */
function onSearched(s: LoggedIn, seq: number, r: SearchResult): Step {
	const query = s.search.pending;
	if (!query || query.seq !== seq) return only(s);
	const listed = (shown: Listing) => only({ ...s, search: { pending: null, shown } });
	switch (r.type) {
		case '見つかった':
			return listed({ kind: '見つかった', query, hits: r.hits });
		case '検索できない':
			return listed({ kind: '検索できない', query });
		case '本人が変わった':
			return busy(s.screen)
				? listed({ kind: '検索できない', query })
				: only({ kind: '未ログイン', error: identityChangedMessage, map: s.map });
	}
}

export const identityChangedMessage =
	'ほかの画面で別の利用者としてログインしたため、この画面での操作を止めました。もう一度ログインしてください';

/** 知らせの受け取り。どの状態でも受け取る(`undefined` を返さない)。
    タイルの本人違い: 副作用の応答を待っている間は、その応答を捨てないように何もしない。
    地図が動いた: ログインしていれば、その範囲を検索する。ログアウト中は範囲だけ覚えておく。 */
export function notify(s: State, n: Notice): Step {
	switch (n.type) {
		case '地図の本人が変わった':
			return s.kind === 'ログイン済み' && !busy(s.screen)
				? only({ kind: '未ログイン', error: identityChangedMessage, map: s.map })
				: only(s);
		case '地図が動いた': {
			const moved = (map: MapView): MapView => ({ ...map, area: n.area });
			switch (s.kind) {
				case '未ログイン':
				case 'ログイン中':
					return only({ ...s, map: moved(s.map) });
				case 'ログイン済み':
					return searchTo({ ...s, map: moved(s.map) }, s.screen);
				case 'ログアウト中':
					return only({ ...s, from: { ...s.from, map: moved(s.from.map) } });
			}
		}
	}
}
