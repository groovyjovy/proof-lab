import fc from 'fast-check';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { roles, type Me } from '#lib/domain.ts';
import {
	init,
	type Area,
	type Op,
	type Reply,
	type SearchResult,
	type State
} from '#lib/app/machine.ts';
import { startOracle, type Oracle } from '../../scripts/spec-oracle.ts';
import { exploring, seed } from '../seed.ts';
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
const ref = fc.record({
	id: fc.constantFrom(1, 2),
	city: fc.constantFrom<'A' | 'B'>('A', 'B'),
	public: fc.boolean()
});
const hit = ref.map((ref) => ({ ref, properties: { name: `地物${ref.id}` } }));
const feature = fc.option(hit);
const area = fc.constantFrom<Area>(
	[
		[0, 0],
		[1, 1]
	],
	[
		[1, 1],
		[2, 2]
	]
);
const moved = area.map((area): Event => ({ notice: { type: '地図が動いた', area } }));
const searchResult = fc.oneof(
	fc.array(hit, { maxLength: 2 }).map((hits): SearchResult => ({ type: '見つかった', hits })),
	fc.constantFrom<SearchResult>({ type: '検索できない' }, { type: '本人が変わった' })
);
const searched = fc
	.tuple(fc.nat(4), searchResult)
	.map(([seq, result]): Event => ({ reply: { type: '検索の応答', seq, result } }));
const edit = fc.record({
	ref,
	version: fc.nat(3),
	name: fc.constantFrom('元の名前', 'n1'),
	note: fc.constantFrom('', '備考')
});
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
			{ type: '公開を選ぶ', public: true },
			{ type: '編集を始める' },
			{ type: '名前を変える', name: 'n1' },
			{ type: '備考を変える', note: '備考' },
			{ type: '読み直す' }
		),
		weight: 4
	},
	{
		arbitrary: fc.constantFrom('u1', 'u2').map((key): Op => ({ type: '編集を保存', key })),
		weight: 1
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
		{ type: '本人が変わった' },
		{ type: '読み込めない' },
		{ type: '競合した' }
	),
	edit.map((edit): Reply => ({ type: '読み込めた', edit }))
);
const editAndSave = fc
	.tuple(ref, edit, fc.constantFrom<Reply['type']>('保存結果不明', '競合した', '保存失敗'))
	.map(([ref, loaded, outcome]): Event[] => [
		{ op: { type: '地図をクリック', at: [0, 0], feature: { ref, properties: {} } } },
		{ op: { type: '編集を始める' } },
		{ reply: { type: '読み込めた', edit: { ...loaded, ref } } },
		{ op: { type: '名前を変える', name: 'n1' } },
		{ op: { type: '編集を保存', key: 'u1' } },
		{ reply: { type: outcome } as Reply },
		{ op: { type: 'ログアウトを押す' } }
	]);
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
			{ arbitrary: moved.map((e) => [e]), weight: 2 },
			{ arbitrary: searched.map((e) => [e]), weight: 2 },
			{
				// 地図を2回動かし、応答を逆の順で返す(追い越し)
				arbitrary: fc
					.tuple(moved, moved, searchResult, searchResult, fc.nat(3))
					.map(([m1, m2, r1, r2, base]): Event[] => [
						m1,
						m2,
						{ reply: { type: '検索の応答', seq: base + 1, result: r1 } },
						{ reply: { type: '検索の応答', seq: base, result: r2 } }
					]),
				weight: 2
			},
			{ arbitrary: drawAndCommit, weight: 1 },
			{
				arbitrary: drawAndCommit.map((es): Event[] => [...es, { reply: { type: '保存結果不明' } }]),
				weight: 1
			},
			{ arbitrary: editAndSave, weight: 2 },
			{
				arbitrary: drawAndCommit.map((es): Event[] => [
					...es,
					{ reply: { type: '保存結果不明' } },
					{ op: { type: '再送' } }
				]),
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

/** 検索の一覧で通ったところ(空振りの確認) */
function searchCoverage(before: State, e: Event, after: State | undefined, seen: Set<string>) {
	if (!('reply' in e) || e.reply.type !== '検索の応答' || !after) return;
	if (before.kind !== 'ログイン済み') return void seen.add('ログインしていないときに届いた');
	const pending = before.search.pending;
	if (!pending || pending.seq !== e.reply.seq) return void seen.add('古い応答を捨てた');
	if (after.kind === '未ログイン') return void seen.add('本人違いで止めた');
	seen.add(`一覧: ${e.reply.result.type}`);
}

/**
 * 生成した列が、狙った場面に届いたか(空振りの確認)。決まった種で流す合否では、届かなければ失敗にする
 * (生成器がその場面に届かなくなった、という確かな知らせになる)。探索では、届かなかった場面を報告する。
 */
function reached(what: string, seen: Set<string>, expected: string[]) {
	if (!exploring) return expect([...seen].sort()).toEqual([...expected].sort());
	const missed = expected.filter((e) => !seen.has(e));
	if (missed.length) console.log(`この種では届かなかった${what}(種 ${seed}):`, missed);
}

const kindOf = (s: State) =>
	s.kind === 'ログイン済み'
		? `${s.kind}/${s.screen.kind}`
		: s.kind === 'ログアウト中'
			? `${s.kind}/${s.from.screen.kind}`
			: s.kind;

test('実装の状態機械は、Lean の仕様(spec/Spec/App.lean)と同じ状態・副作用・差し出す操作を返す', async () => {
	const visited = new Set<string>();
	const searchSeen = new Set<string>();
	await fc.assert(
		fc.asyncProperty(fc.option(me), events, async (start, es) => {
			const expected = normalize(await oracle.ask({ me: start, events: es }));
			const actual = runImplementation(start, es);
			expect(actual).toEqual(expected);
			let state = init(start);
			es.forEach((e, i) => {
				const after = actual.steps[i]?.state;
				searchCoverage(state, e, after, searchSeen);
				if (after) state = after;
			});
			for (const s of actual.steps) if (s) visited.add(kindOf(s.state));
		}),
		{ numRuns: 2000 }
	);
	reached('検索の応答', searchSeen, [
		'ログインしていないときに届いた',
		'古い応答を捨てた',
		'本人違いで止めた',
		'一覧: 見つかった',
		'一覧: 検索できない',
		'一覧: 本人が変わった'
	]);
	const loggedIn = ['閲覧', '描画中', '保存中', '再送中', '結果不明'];
	const editing = ['読込中', '編集中', '更新中', '更新結果不明', '競合'];
	const loggingOut = ['閲覧', '描画中', '結果不明', '編集中', '更新結果不明', '競合'];
	reached('画面の状態', visited, [
		'未ログイン',
		'ログイン中',
		...[...loggedIn, ...editing].map((v) => `ログイン済み/${v}`),
		...loggingOut.map((v) => `ログアウト中/${v}`)
	]);
});
