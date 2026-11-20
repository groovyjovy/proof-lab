import fc from 'fast-check';
import { expect, test } from 'vitest';
import { init, next, saving, type Event, type State } from '#lib/app/machine.ts';

const point = fc.tuple(fc.double({ noNaN: true }), fc.double({ noNaN: true }));
const key = fc.constantFrom('k1', 'k2', 'k3');

const event: fc.Arbitrary<Event> = fc.oneof(
	fc.constant<Event>({ type: 'ログアウトを押す' }),
	fc.constantFrom<Event>({ type: 'ログアウト完了' }, { type: 'ログアウト失敗' }),
	point.map((at): Event => ({ type: '地図をクリック', at, feature: null })),
	key.map((k): Event => ({ type: '描画開始', key: k })),
	fc.constantFrom<Event>(
		{ type: '市を選ぶ', city: 'B' },
		{ type: '公開を選ぶ', public: true },
		{ type: '確定' },
		{ type: '取消' },
		{ type: '再送' }
	),
	fc.constantFrom<Event>({ type: '保存成功' }, { type: '保存失敗' }, { type: '保存結果不明' })
);

const drawAndCommit = fc
	.tuple(key, fc.array(point, { minLength: 3, maxLength: 5 }))
	.map(([k, ps]): Event[] => [
		{ type: '描画開始', key: k },
		...ps.map((at): Event => ({ type: '地図をクリック', at, feature: null })),
		{ type: '確定' }
	]);

const events = fc
	.array(
		fc.oneof(
			event.map((e) => [e]),
			drawAndCommit
		),
		{ maxLength: 20 }
	)
	.map((chunks) => chunks.flat());

const initial: State = init({ name: 'A市職員', role: 'a-staff', canEdit: true });
const savingKey = (s: State) =>
	s.kind === 'ログイン済み' && saving(s.screen) ? s.screen.draft.key : null;
const draftKey = (s: State) =>
	s.kind === 'ログイン済み' && s.screen.kind !== '閲覧' ? s.screen.draft.key : null;

test('P6 UIの排他: どんな操作列でも、保存中に新しい描画は始まらない', () => {
	let savingVisits = 0;
	fc.assert(
		fc.property(events, (es) => {
			let s = initial;
			for (const e of es) {
				const t = next(s, e).state;
				const k = savingKey(s);
				if (k !== null) {
					savingVisits++;
					expect([k, null]).toContain(draftKey(t));
				}
				s = t;
			}
		})
	);
	expect(savingVisits).toBeGreaterThan(0);
});

test('L1 保存中は必ず終わる(状態機械の側): どの保存中の状態からも、結果不明が届けば保存中を抜ける', () => {
	let savingVisits = 0;
	fc.assert(
		fc.property(events, (es) => {
			let s = initial;
			for (const e of es) {
				s = next(s, e).state;
				if (savingKey(s) === null) continue;
				savingVisits++;
				expect(savingKey(next(s, { type: '保存結果不明' }).state)).toBeNull();
			}
		})
	);
	expect(savingVisits).toBeGreaterThan(0);
});
