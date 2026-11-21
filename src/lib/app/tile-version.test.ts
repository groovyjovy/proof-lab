import { expect, test } from 'vitest';
import { init, offers, perform, receive } from './machine.ts';

test('P16 古いタイルから選んだ地物を新しい DB の版として編集しない', () => {
	const app = init({ id: 'u-admin', name: '管理者', role: 'admin', canEdit: true });
	const ref = { id: 1, city: 'A' as const, public: true };
	const hit = { ref: { ...ref, version: 0 }, properties: { version: 0 } };
	const selected = perform(offers(app), { type: '地図をクリック', at: [0, 0], feature: hit })!;
	const loading = perform(offers(selected.state), { type: '編集を始める' })!;
	const result = receive(loading.state, {
		type: '読み込めた',
		edit: { ref, version: 1, name: '変更後の名前', note: '' }
	})!;
	expect(result.state).toMatchObject({ kind: 'ログイン済み', screen: { kind: '閲覧' } });
});
