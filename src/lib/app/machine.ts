import { canRead, canWrite, type City, type Me } from '#lib/domain.ts';
import { isBoundaryPosition, type BoundaryPosition, type BoundarySnapshot } from '#lib/boundary.ts';

export type Point = [lng: number, lat: number];
export type Draft = { key: string; city: City; public: boolean; points: Point[] };
export type FeatureRef = { id: number; city: City; public: boolean; version?: number };
export type Hit = { ref: FeatureRef; properties: Record<string, unknown> };
export type Selected = { at: Point } & Hit;
/** 編集中の値。版は、サーバーから読み込んだときのもの(P4)。 */
export type BoundaryEdit = BoundarySnapshot & {
	verifiedVersion: number | null;
	draft: BoundaryPosition | null;
};
export type Edit = {
	ref: FeatureRef;
	version: number;
	name: string;
	note: string;
	boundary?: BoundaryEdit;
};

export type Screen =
	| { kind: '閲覧'; selected: Selected | null }
	| { kind: '描画中'; draft: Draft; notice: '保存失敗' | null }
	| { kind: '保存中'; draft: Draft }
	| { kind: '結果不明'; draft: Draft; notice: '再送失敗' | null }
	| { kind: '再送中'; draft: Draft }
	| { kind: '読込中'; ref: FeatureRef }
	/** `stale`: ほかの人がこの地物を、読み込んだときより新しい版にしたと知らされた(P14) */
	| { kind: '編集中'; edit: Edit; notice: '更新失敗' | null; stale: boolean }
	/** `applied`: このキーが効いたという変更の知らせが、応答より先に届いた(P14) */
	| { kind: '更新中'; edit: Edit; key: string; applied: boolean }
	| { kind: '更新結果不明'; edit: Edit; key: string; notice: '再送失敗' | null }
	/** 結果が分からない更新を、同じキーで送り直した(P12)。拒否されても、前に送ったときに効いたかもしれない
	    ので、結果不明に戻る(P15: 権限を外されたあとは、効いたキーの送り直しもサーバーが拒否する) */
	| { kind: '更新の再送中'; edit: Edit; key: string; applied: boolean }
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
/** 範囲の一覧。応答を待つのは、いちばん新しい検索だけ(それより前の検索の応答は、届いても捨てる)。
    `since` は、今の権限で振った最初の番号(P15)。権限が変わったら、一覧を消してここから振り直す。 */
export type Search = { pending: Query | null; shown: Listing | null; since: number };

export type LoggedIn = {
	kind: 'ログイン済み';
	me: Me;
	tiles: number;
	screen: Screen;
	map: MapView;
	search: Search;
	mapLag: [id: number, version: number] | null;
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
	| { type: '境界を動かす'; position: number }
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
/** サーバーで地物が変わったという知らせ(変更の流れから届く)。キーは効いた要求のもの
    (作成は request_key、更新は feature_update のキー)。`as` は変更の流れを開いた本人。 */
export type Change = { id: number; version: number; key: string; as: string };

export type Notice =
	| { type: '地図の本人が変わった' }
	| { type: '地図が動いた'; area: Area }
	| { type: '地物が変わった'; change: Change }
	/** 変更の流れが切れて、つなぎ直した。切れている間の変更は、取りこぼしたかもしれない */
	| { type: '変更の流れをつなぎ直した'; as: string }
	/** 本人の権限(ロール・編集権限)が変わった(P15)。変更の流れから届く。中身は、サーバーが DB から
	    読んだ新しい本人 */
	| { type: '権限が変わった'; me: Me };

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
	mapLag: null,
	screen: { kind: '閲覧', selected: null },
	map,
	search: { pending: null, shown: null, since: map.issued }
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
export const busy = (v: Screen) =>
	saving(v) || v.kind === '読込中' || v.kind === '更新中' || v.kind === '更新の再送中';

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

const canStartTileEdit = (s: LoggedIn, ref: FeatureRef) =>
	canWrite(s.me, ref) &&
	ref.version !== undefined &&
	(s.mapLag?.[0] !== ref.id || ref.version >= s.mapLag[1]);

const reloadRef = ({ id, city, public: visible }: FeatureRef): FeatureRef => ({
	id,
	city,
	public: visible
});

const verifiedBoundary = (b: BoundaryEdit) => b.verifiedVersion === b.neighborVersion;

function verifyNeighbor(b: BoundaryEdit, feature: Hit | null): BoundaryEdit {
	if (feature?.ref.id !== b.neighborId) return b;
	const version = feature.ref.version;
	return version === b.neighborVersion
		? { ...b, verifiedVersion: version }
		: { ...b, verifiedVersion: null, draft: null };
}

function resetBoundary(e: Edit): Edit {
	return e.boundary ? { ...e, boundary: { ...e.boundary, verifiedVersion: null, draft: null } } : e;
}

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
		to({ kind: '更新中', edit, key, applied: false }, [
			{ type: '更新する', edit, key, as: s.me.id }
		]);
	const v = s.screen;
	switch (v.kind) {
		case '閲覧':
			return {
				// 今の権限で読めない地物は選ばない(権限が変わった直後は、古いタイルがまだ描かれていることがある。P15)
				地図をクリック: (e) =>
					to({
						kind: '閲覧',
						selected: e.feature && canRead(s.me, e.feature.ref) ? { at: e.at, ...e.feature } : null
					}),
				ポップアップを閉じる: v.selected ? () => to({ kind: '閲覧', selected: null }) : undefined,
				編集を始める:
					v.selected && canStartTileEdit(s, v.selected.ref)
						? () => load(v.selected!.ref)
						: undefined,
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
				// 保存できるかは、送るときの権限で決める(P15)
				確定:
					d.points.length >= 3 && canWrite(s.me, d)
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
			const b = e.boundary;
			const writable = canWrite(s.me, e.ref);
			return {
				地図をクリック: b
					? (op) => to({ ...v, edit: { ...e, boundary: verifyNeighbor(b, op.feature) } })
					: undefined,
				名前を変える: (op) => to({ ...v, edit: { ...e, name: op.name } }),
				備考を変える: (op) => to({ ...v, edit: { ...e, note: op.note } }),
				境界を動かす:
					b && writable && verifiedBoundary(b)
						? ({ position }) =>
								to({
									...v,
									edit: {
										...e,
										boundary: isBoundaryPosition(position)
											? { ...b, draft: position === b.position ? null : position }
											: b
									}
								})
						: undefined,
				編集を保存:
					writable && (!b || b.draft === null || verifiedBoundary(b))
						? (op) => update(e, op.key)
						: undefined,
				読み直す: v.stale ? () => load(reloadRef(e.ref)) : undefined,
				取消: () => to({ kind: '閲覧', selected: null })
			};
		}
		case '更新結果不明':
			return {
				再送: () =>
					to({ kind: '更新の再送中', edit: v.edit, key: v.key, applied: false }, [
						{ type: '更新する', edit: v.edit, key: v.key, as: s.me.id }
					]),
				取消: () => refreshTo(s, { kind: '閲覧', selected: null })
			};
		case '競合':
			return {
				読み直す: () => load(reloadRef(v.edit.ref)),
				取消: () => to({ kind: '閲覧', selected: null })
			};
		case '保存中':
		case '再送中':
		case '読込中':
		case '更新中':
		case '更新の再送中':
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
				case '読み込めた': {
					const { id, version } = v.ref;
					if (r.edit.ref.id !== id || (version !== undefined && r.edit.version !== version))
						return refreshTo(
							{ ...s, mapLag: [id, r.edit.version] },
							{ kind: '閲覧', selected: null }
						);
					return only({
						...s,
						mapLag: s.mapLag?.[0] === id ? null : s.mapLag,
						screen: { kind: '編集中', edit: resetBoundary(r.edit), notice: null, stale: false }
					});
				}
				case '読み込めない':
					return to({ kind: '閲覧', selected: null });
				default:
					return undefined;
			}
		case '更新中':
		case '更新の再送中': {
			const refresh = () =>
				refreshTo(
					{ ...s, mapLag: [v.edit.ref.id, v.edit.version + 1] },
					{ kind: '閲覧', selected: null }
				);
			switch (r.type) {
				case '保存成功':
					return refresh();
				case '保存結果不明':
					// 効いたという知らせが先に届いていれば、応答が分からなくても成功(P14)
					return v.applied
						? refresh()
						: to({ kind: '更新結果不明', edit: v.edit, key: v.key, notice: null });
				case '保存失敗':
					// 送り直しが拒否されても、前に送ったときに効いたかもしれない(P15)
					return to(
						v.kind === '更新中'
							? { kind: '編集中', edit: v.edit, notice: '更新失敗', stale: false }
							: { kind: '更新結果不明', edit: v.edit, key: v.key, notice: '再送失敗' }
					);
				case '競合した':
					return to({ kind: '競合', edit: v.edit });
				default:
					return undefined;
			}
		}
	}
}

/** 検索の応答。応答を待っているいちばん新しい検索への応答だけを一覧に出し、ほかは何も変えずに捨てる。
    本人が変わったという応答も、いちばん新しい検索へのものだけを信じる(前の本人として送った検索なら、
    今の本人は変わっていない)。ほかの副作用の応答を待っている間は、その応答を捨てないようにログアウトしない。 */
function onSearched(s: LoggedIn, seq: number, r: SearchResult): Step {
	const query = s.search.pending;
	if (!query || query.seq !== seq) return only(s);
	const listed = (shown: Listing) => only({ ...s, search: { ...s.search, pending: null, shown } });
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

/** 地物が変わったという知らせ(P14)。地図と一覧は読み直す。応答待ちの状態は抜けない(応答を捨てない)。
    - 更新中(送り直しを含む): 自分のキーなら、効いたと覚えておく(応答が結果不明でも成功にできる)
    - 更新結果不明: 自分のキーなら、効いていたので成功
    - 編集中: 編集している地物が、読み込んだときより新しい版になったら知らせる。自分の更新が戻ってきた
      知らせは、読み込んだ版と同じなので知らせない */
function onChanged(s: LoggedIn, c: Change): Step {
	const v = s.screen;
	switch (v.kind) {
		case '更新中':
		case '更新の再送中':
			return c.key === v.key ? only({ ...s, screen: { ...v, applied: true } }) : refreshTo(s, v);
		case '更新結果不明':
			return refreshTo(s, c.key === v.key ? { kind: '閲覧', selected: null } : v);
		case '編集中':
			return refreshTo(
				s,
				c.id === v.edit.ref.id && v.edit.version < c.version ? { ...v, stale: true } : v
			);
		default:
			return refreshTo(s, v);
	}
}

/** 地図が動いた: ログインしていれば、その範囲を検索する。ログアウト中は範囲だけ覚えておく。 */
function mapMoved(s: State, area: Area): Step {
	const moved = (map: MapView): MapView => ({ ...map, area });
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

/** 権限が変わったと知らされたセッション(P15)。本人を差し替え、選んでいた地物(古い権限のタイルの属性を
    持っている)を外し、一覧を消して、今の権限での番号の始まり(`since`)を置き直す。下書きと編集は残す
    (送れるかは、送るときの権限で決める)。応答待ちの画面はそのまま。 */
const withPermission = (s: LoggedIn, me: Me): LoggedIn => ({
	...s,
	me,
	screen: s.screen.kind === '閲覧' ? { kind: '閲覧', selected: null } : s.screen,
	search: { pending: null, shown: null, since: s.map.issued }
});

/** 同じ本人で、権限(または名前)が今のものと違う。 */
const changedPermission = (now: Me, next: Me) =>
	next.id === now.id &&
	(next.name !== now.name || next.role !== now.role || next.canEdit !== now.canEdit);

/** 知らせの受け取り。どの状態でも受け取る(`undefined` を返さない)。
    タイルの本人違い: 副作用の応答を待っている間は、その応答を捨てないように何もしない。
    地図が動いた: ログインしていれば、その範囲を検索する。ログアウト中は範囲だけ覚えておく。
    地物が変わった・つなぎ直した: ログインしていて、今の本人の流れからなら受け取る。
    権限が変わった: 今の本人の知らせで、権限が今のものと違えば、差し替えて地図と一覧を読み直す
    (`withPermission`)。ログアウト中は、差し替えて一覧を消すだけにし、ログアウトに失敗したら検索し直す。
    サーバーは変更の流れをつなぐたびに今の本人を送るので、変わっていなければ何もしない(つなぎ直すたびに
    選択や一覧を消さない)。 */
export function notify(s: State, n: Notice): Step {
	switch (n.type) {
		case '地図の本人が変わった':
			return s.kind === 'ログイン済み' && !busy(s.screen)
				? only({ kind: '未ログイン', error: identityChangedMessage, map: s.map })
				: only(s);
		case '地図が動いた':
			return mapMoved(s, n.area);
		case '地物が変わった':
			return s.kind === 'ログイン済み' && n.change.as === s.me.id
				? onChanged(s, n.change)
				: only(s);
		case '変更の流れをつなぎ直した':
			return s.kind === 'ログイン済み' && n.as === s.me.id ? refreshTo(s, s.screen) : only(s);
		case '権限が変わった':
			if (s.kind === 'ログイン済み' && changedPermission(s.me, n.me)) {
				const next = withPermission(s, n.me);
				return refreshTo(next, next.screen);
			}
			if (s.kind === 'ログアウト中' && changedPermission(s.from.me, n.me))
				return only({ ...s, from: withPermission(s.from, n.me) });
			return only(s);
	}
}
