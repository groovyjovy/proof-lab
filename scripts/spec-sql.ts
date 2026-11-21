import { readFile, writeFile } from 'node:fs/promises';
import { buildSpec, startOracle } from './spec-oracle.ts';

// 認可の SQL 関数は、Lean の仕様(spec/Spec/Authz.lean の readCond・writeCond・ownerCond)から書き出す。
export const migration = 'db/migrations/002_feature.sql';
const begin =
	'-- ここから生成: spec/Spec/Authz.lean の readCond・writeCond・ownerCond から pnpm spec:sql で書き出す。手で書き換えない\n';
const end = '-- ここまで生成\n';

export async function policySql(): Promise<string> {
	const oracle = startOracle();
	const { sql } = (await oracle.ask({ policySql: true })) as { sql: string };
	oracle.close();
	return sql;
}

function bounds(text: string): [start: number, stop: number] {
	const i = text.indexOf(begin);
	const j = text.indexOf(end);
	if (i < 0 || j < i) throw new Error(`${migration} に生成部分の印がない`);
	return [i + begin.length, j];
}

export function generatedPart(text: string): string {
	const [start, stop] = bounds(text);
	return text.slice(start, stop);
}

if (import.meta.main) {
	buildSpec();
	const text = await readFile(migration, 'utf8');
	const sql = await policySql();
	const [start, stop] = bounds(text);
	await writeFile(migration, text.slice(0, start) + sql + text.slice(stop));
	console.log(`${migration} の生成部分を書き直した`);
}
