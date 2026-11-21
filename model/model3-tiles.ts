import { init, notify, offers, perform, receive, type Edit, type State } from '#lib/app/machine.ts';
import type { Step } from './check.ts';

type Version = 0 | 1;
type Tile = 0 | 1;
type World = {
	app: State;
	db: Version;
	drawn: [Version, Version];
	remaining: number;
	clicked: Version | null;
	loaded: Version | null;
	wrongEdit: boolean;
};

const ref = { id: 1, city: 'A' as const, public: true };
const as = 'u-admin';
export const initial: World = {
	app: init({ id: as, name: '管理者', role: 'admin', canEdit: true }),
	db: 0,
	drawn: [0, 0],
	remaining: 0b1111,
	clicked: null,
	loaded: null,
	wrongEdit: false
};

export const tileSteps =
	(read = receive) =>
	(w: World): Step<World>[] => {
		const out: Step<World>[] = [];
		const allowed = offers(w.app);
		if (w.db === 0) {
			const step = notify(w.app, {
				type: '地物が変わった',
				change: { id: ref.id, version: 1, key: 'other', as }
			});
			out.push(['境界の変更を確定する', { ...w, db: 1, app: step.state }]);
		}
		for (const tile of [0, 1] as const) {
			for (const v of [0, 1] as const) {
				const bit = 1 << (tile * 2 + v);
				if (v <= w.db && (w.remaining & bit) !== 0) {
					const drawn = [...w.drawn] as [Version, Version];
					drawn[tile] = v;
					out.push([
						`タイル${tile + 1}に版${v}が届く`,
						{ ...w, drawn, remaining: w.remaining ^ bit }
					]);
				}
			}
			const version = w.drawn[tile];
			const feature = { ref: { ...ref, version }, properties: {} };
			const clicked = perform(allowed, { type: '地図をクリック', at: [tile, 0], feature });
			if (clicked)
				out.push([
					`タイル${tile + 1}の版${version}をクリック`,
					{ ...w, app: clicked.state, clicked: version }
				]);
		}
		const started = perform(allowed, { type: '編集を始める' });
		if (started) out.push(['編集を要求する', { ...w, app: started.state }]);
		if (w.app.kind === 'ログイン済み' && w.app.screen.kind === '読込中') {
			if (w.loaded === null) out.push(['DBの版を読む', { ...w, loaded: w.db }]);
			else {
				const edit: Edit = { ref, version: w.loaded, name: '区画', note: '' };
				const received = read(w.app, { type: '読み込めた', edit });
				const editing =
					received?.state.kind === 'ログイン済み' && received.state.screen.kind === '編集中';
				if (received)
					out.push([
						'読み込みの応答が届く',
						{
							...w,
							app: received.state,
							loaded: null,
							wrongEdit: w.wrongEdit || (editing && w.clicked !== edit.version)
						}
					]);
			}
		}
		return out;
	};
