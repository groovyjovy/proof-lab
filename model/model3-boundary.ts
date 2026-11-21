import { init, offers, perform, receive, type Op, type State } from '#lib/app/machine.ts';
import type { Step } from './check.ts';

type Version = 0 | 1;
type World = {
	app: State;
	db: Version;
	tiles: [Version, Version];
	neighborClicked: Version | null;
	sentWrongBoundary: boolean;
};

const ref = { id: 1, city: 'A' as const, public: true };
export const initial: World = {
	app: init({ id: 'u-admin', name: '管理者', role: 'admin', canEdit: true }),
	db: 0,
	tiles: [0, 0],
	neighborClicked: null,
	sentWrongBoundary: false
};

export const boundarySteps =
	(opForApp: (app: State, op: Op) => Op = (_, op) => op) =>
	(w: World): Step<World>[] => {
		const screen = w.app.kind === 'ログイン済み' ? w.app.screen : null;
		if (screen?.kind === '更新中') return [];
		const result: Step<World>[] = [];
		const actions = offers(w.app);
		const operate = (op: Op) => perform(actions, opForApp(w.app, op));
		if (w.db === 0) result.push(['両区画を版1で確定', { ...w, db: 1 }]);
		for (const side of [0, 1] as const) {
			if (w.tiles[side] !== w.db) {
				const tiles = [...w.tiles] as [Version, Version];
				tiles[side] = w.db;
				result.push([`タイル${side + 1}に版${w.db}が届く`, { ...w, tiles }]);
			}
			if (side === 1 && screen?.kind !== '編集中') continue;
			const version = w.tiles[side];
			const click = operate({
				type: '地図をクリック',
				at: [side, 0],
				feature: { ref: { ...ref, id: side + 1, version }, properties: {} }
			});
			if (click)
				result.push([
					`区画${side + 1}の版${version}をクリック`,
					{
						...w,
						app: click.state,
						neighborClicked: screen?.kind === '編集中' && side === 1 ? version : w.neighborClicked
					}
				]);
		}
		const start = operate({ type: '編集を始める' });
		if (start) result.push(['編集を要求', { ...w, app: start.state }]);
		if (screen?.kind === '読込中') {
			const id = screen.ref.id;
			const loaded = receive(w.app, {
				type: '読み込めた',
				edit: {
					ref: { ...ref, id },
					version: w.db,
					name: '区画',
					note: '',
					boundary:
						id === 1
							? {
									neighborId: 2,
									neighborVersion: w.db,
									position: 1,
									verifiedVersion: null,
									draft: null
								}
							: undefined
				}
			});
			if (loaded) result.push(['DBの区画を読み込み', { ...w, app: loaded.state }]);
		}
		const moved = operate({ type: '境界を動かす', position: 2 });
		if (moved) result.push(['境界を東へ動かす', { ...w, app: moved.state }]);
		const save = operate({ type: '編集を保存', key: 'boundary' });
		if (save) {
			const sent = save.effects.find((e) => e.type === '更新する')?.edit.boundary;
			if (sent?.draft != null)
				result.push([
					'境界の保存を要求',
					{
						...w,
						app: save.state,
						sentWrongBoundary: sent.neighborVersion !== w.neighborClicked
					}
				]);
		}
		return result;
	};
