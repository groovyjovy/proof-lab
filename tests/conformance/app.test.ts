import fc from 'fast-check';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { roles, type Me } from '#lib/domain.ts';
import { init, type Op, type Reply, type State } from '#lib/app/machine.ts';
import { startOracle, type Oracle } from '../../scripts/spec-oracle.ts';
import { applyEvent, normalize, snapshot, type Event } from './implementation.ts';

let oracle: Oracle;
beforeAll(() => {
	oracle = startOracle();
});
afterAll(() => oracle.close());

const me: fc.Arbitrary<Me> = fc.record({
	id: fc.constantFrom('u-admin', 'u-a'),
	name: fc.constantFrom('管理者', 'A市職員'),
	role: fc.constantFrom(...roles),
	canEdit: fc.boolean()
});
const at = fc.tuple(fc.integer({ min: -180, max: 180 }), fc.integer({ min: -90, max: 90 }));
const feature = fc.constantFrom(null, { name: 'A市の地物01' }, { city: 'B', version: 2 });
const key = fc.constantFrom('k1', 'k2');

const op: fc.Arbitrary<Op> = fc.oneof(
	{ arbitrary: at.map((at): Op => ({ type: '地図をクリック', at, feature: null })), weight: 6 },
	{
		arbitrary: fc.record({ at, feature }).map((p): Op => ({ type: '地図をクリック', ...p })),
		weight: 2
	},
	{ arbitrary: key.map((key): Op => ({ type: '描画開始', key })), weight: 2 },
	{
		arbitrary: fc.constantFrom<Op>(
			{ type: '確定' },
			{ type: '取消' },
			{ type: '再送' },
			{ type: 'ログアウトを押す' },
			{ type: 'ポップアップを閉じる' },
			{ type: '市を選ぶ', city: 'B' },
			{ type: '公開を選ぶ', public: true }
		),
		weight: 4
	},
	{ arbitrary: fc.constantFrom<Op>({ type: 'ログインを押す', email: 'a@example.com' }), weight: 1 }
);
const reply: fc.Arbitrary<Reply> = fc.oneof(
	me.map((me): Reply => ({ type: 'ログイン成功', me })),
	fc.constantFrom<Reply>(
		{ type: 'ログイン失敗', message: '失敗' },
		{ type: 'ログアウト完了' },
		{ type: 'ログアウト失敗' },
		{ type: '保存成功' },
		{ type: '保存失敗' },
		{ type: '保存結果不明' },
		{ type: '本人が変わった' }
	)
);
const drawAndCommit = fc
	.tuple(key, fc.array(at, { minLength: 3, maxLength: 4 }))
	.map(([key, points]): Event[] => [
		{ op: { type: '描画開始', key } },
		...points.map((at): Event => ({ op: { type: '地図をクリック', at, feature: null } })),
		{ op: { type: '確定' } }
	]);
const events = fc
	.array(
		fc.oneof(
			{ arbitrary: op.map((op): Event[] => [{ op }]), weight: 3 },
			{ arbitrary: reply.map((reply): Event[] => [{ reply }]), weight: 2 },
			{
				arbitrary: fc.constant<Event[]>([{ notice: { type: '地図の本人が変わった' } }]),
				weight: 1
			},
			{ arbitrary: drawAndCommit, weight: 1 },
			{
				arbitrary: drawAndCommit.map((es): Event[] => [...es, { reply: { type: '保存結果不明' } }]),
				weight: 1
			},
			{
				arbitrary: fc
					.tuple(key, at)
					.map(([key, at]): Event[] => [
						{ op: { type: '描画開始', key } },
						{ op: { type: '地図をクリック', at, feature: null } },
						{ op: { type: 'ログアウトを押す' } }
					]),
				weight: 1
			},
			{
				arbitrary: drawAndCommit.map((es): Event[] => [
					...es,
					{ reply: { type: '保存結果不明' } },
					{ op: { type: 'ログアウトを押す' } }
				]),
				weight: 1
			}
		),
		{ maxLength: 20 }
	)
	.map((chunks) => chunks.flat());

function runImplementation(start: Me | null, es: Event[]) {
	let s = init(start);
	const steps = es.map((e) => {
		const step = applyEvent(s, e);
		if (!step) return null;
		s = step.state;
		return snapshot(step.state, step.effects);
	});
	return normalize({ initial: snapshot(init(start), []), steps });
}

const kindOf = (s: State) =>
	s.kind === 'ログイン済み'
		? `${s.kind}/${s.screen.kind}`
		: s.kind === 'ログアウト中'
			? `${s.kind}/${s.from.screen.kind}`
			: s.kind;

test('実装の状態機械は、Lean の仕様(spec/Spec/App.lean)と同じ状態・副作用・差し出す操作を返す', async () => {
	const visited = new Set<string>();
	await fc.assert(
		fc.asyncProperty(fc.option(me), events, async (start, es) => {
			const expected = normalize(await oracle.ask({ me: start, events: es }));
			const actual = runImplementation(start, es);
			expect(actual).toEqual(expected);
			for (const s of actual.steps) if (s) visited.add(kindOf(s.state));
		}),
		{ numRuns: 2000 }
	);
	expect([...visited].sort()).toEqual(
		[
			'未ログイン',
			'ログイン中',
			...['閲覧', '描画中', '保存中', '再送中', '結果不明'].map((v) => `ログイン済み/${v}`),
			...['閲覧', '描画中', '保存中', '再送中', '結果不明'].map((v) => `ログアウト中/${v}`)
		]
			.filter((k) => !['ログアウト中/保存中', 'ログアウト中/再送中'].includes(k))
			.sort()
	);
});
