import { expect, test } from 'vitest';
import { explore } from './check.ts';
import { boundarySteps, initial } from './model3-boundary.ts';

const properties = {
	隣の区画の版を取り違えた保存: (w: { sentWrongBoundary: boolean }) => !w.sentWrongBoundary
};

test('P17 タイルの更新がずれても、確認した版の組だけで境界の移動を送る', () => {
	const result = explore(initial, boundarySteps(), properties, (w) => {
		const s = w.app.kind === 'ログイン済み' ? w.app.screen : null;
		if (s?.kind === '編集中' && s.edit.version === 1 && w.neighborClicked === 0)
			return ['片側が旧版'];
		if (s?.kind === '更新中' && s.edit.version === 1 && s.edit.boundary?.draft != null)
			return ['両側が揃い保存'];
		return [];
	});
	expect(result.failed).toEqual({});
	expect(result.states).toBe(67);
	expect([...result.seen].sort()).toEqual(['両側が揃い保存', '片側が旧版'].sort());
});

test('P17 対照: 隣の地物の版を見なければ、旧版が残っていても共有境界を送る', () => {
	const steps = boundarySteps((app, op) => {
		if (
			app.kind !== 'ログイン済み' ||
			app.screen.kind !== '編集中' ||
			op.type !== '地図をクリック' ||
			!op.feature ||
			!app.screen.edit.boundary
		)
			return op;
		return {
			...op,
			feature: {
				...op.feature,
				ref: { ...op.feature.ref, version: app.screen.edit.boundary.neighborVersion }
			}
		};
	});
	const result = explore(initial, steps, properties);
	expect(result.failed['隣の区画の版を取り違えた保存']).toContain('区画2の版0をクリック');
});
