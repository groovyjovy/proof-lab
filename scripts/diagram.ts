// docs/screens.md の状態図を、モデル3の全探索から作り直す(pnpm diagram)。
// 状態機械を変えたら流す。図が古いままだと model/state-diagram.test.ts が落ちる。
import { readFile, writeFile } from 'node:fs/promises';
import { stateDiagram } from '../model/state-diagram.ts';

const file = 'docs/screens.md';
const doc = await readFile(file, 'utf8');
const block = /```mermaid\nstateDiagram-v2\n[\s\S]*?\n```/;
if (!block.test(doc)) throw new Error(`${file} に状態図(mermaid の stateDiagram-v2)がない`);
const next = doc.replace(block, ['```mermaid', stateDiagram().mermaid, '```'].join('\n'));
await writeFile(file, next);
console.log(next === doc ? '状態図は最新だった' : `${file} の状態図を書き直した`);
