// フェーズの区切りに流す乱数の探索。毎回の合否(pnpm test)とは別に流す。
// 1. 乱数を使う性質テスト(fast-check)を、毎回違う種で流す。破れたら、表示した種で同じ入力を再現できる
// 2. 本物の画面の探索(Bombadil と、障害を起こすプロキシ)。こちらは再現できないので、記録を読む
// 見つけた現象は、決まった入力のテスト(E2E、モデル3の対照、モデルの環境のイベント)にしてから直す(CLAUDE.md)
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const timeLimit = process.argv[2] ?? '3m';
const seed = Math.floor(Math.random() * 2 ** 31);

const randomTests = readdirSync('tests', { recursive: true })
	.map((f) => join('tests', String(f)))
	.filter((f) => f.endsWith('.test.ts') && readFileSync(f, 'utf8').includes("from 'fast-check'"))
	.sort();

console.log(`乱数の種 ${seed}(性質テスト ${randomTests.length} ファイル)`);
const properties = spawnSync('node_modules/.bin/vitest', ['run', ...randomTests], {
	stdio: 'inherit',
	env: { ...process.env, SEED: String(seed) }
});

console.log(`\n本物の画面の探索(${timeLimit})`);
const ui = spawnSync('node', ['--env-file=.env', 'tests/ui/run.ts', timeLimit], {
	stdio: 'inherit'
});

console.log('\n探索のまとめ');
console.log(
	properties.status === 0
		? `- 性質テスト(種 ${seed}): 破れた性質なし`
		: `- 性質テスト(種 ${seed}): 破れた性質あり。同じ入力で再現する: SEED=${seed} pnpm test <上で落ちたファイル>`
);
console.log(
	ui.status === 0
		? '- 本物の画面: 破れた性質なし'
		: '- 本物の画面: 破れた性質あり。上の記録(トレース・スクリーンショット・プロキシの記録)を読む'
);
process.exitCode = properties.status || ui.status ? 1 : 0;
