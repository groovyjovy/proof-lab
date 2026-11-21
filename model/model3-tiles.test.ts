import { expect, test } from 'vitest';
import { receive } from '#lib/app/machine.ts';
import { explore } from './check.ts';
import { initial, tileSteps } from './model3-tiles.ts';

test('P16 二つのタイルの応答が追い越しても、クリックした版でしか編集を始めない', () => {
	const result = explore(initial, tileSteps(), { 版の取り違え: (w) => !w.wrongEdit }, (w) => {
		const scene: string[] = [];
		if (w.drawn[0] !== w.drawn[1]) scene.push('二つのタイルで版が違う');
		if (w.app.kind === 'ログイン済み' && w.app.mapLag) scene.push('旧版のクリックを拒否');
		if (w.app.kind === 'ログイン済み' && w.app.screen.kind === '編集中' && w.clicked === 1)
			scene.push('新版から編集を始めた');
		return scene;
	});
	expect(result.failed).toEqual({});
	expect(result.states).toBe(485);
	expect([...result.seen].sort()).toEqual(
		['二つのタイルで版が違う', '新版から編集を始めた', '旧版のクリックを拒否'].sort()
	);
});

test('P16 対照: クリックした版を忘れると DB の新版を旧版の図形から編集する', () => {
	const forgetTileVersion: typeof receive = (s, reply) => {
		if (s.kind === 'ログイン済み' && s.screen.kind === '読込中' && reply.type === '読み込めた') {
			return receive(
				{ ...s, screen: { ...s.screen, ref: { ...s.screen.ref, version: undefined } } },
				reply
			);
		}
		return receive(s, reply);
	};
	const result = explore(initial, tileSteps(forgetTileVersion), {
		版の取り違え: (w) => !w.wrongEdit
	});
	expect(result.failed['版の取り違え']).toEqual([
		'初期状態',
		'境界の変更を確定する',
		'タイル1の版0をクリック',
		'編集を要求する',
		'DBの版を読む',
		'読み込みの応答が届く'
	]);
});
