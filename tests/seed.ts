/**
 * 乱数を使うテストの種。
 * - `pnpm test`(毎回の合否)は決まった種で流す。何度流しても同じ入力を試すので、運で通ったり落ちたりしない
 * - フェーズの区切りの探索(`pnpm explore`)は、毎回違う種を `SEED` で渡す。見つけたものは、同じ種で再現できる
 *   (`SEED=<種> pnpm test <ファイル>`)。再現できたら、決まった入力のテストにしてから直す(CLAUDE.md)
 */
const fixedSeed = 20261122;

const given = process.env.SEED;
if (given !== undefined && !/^\d+$/.test(given)) throw new Error(`SEED は整数: ${given}`);

export const seed = given === undefined ? fixedSeed : Number(given);

/** 探索している(種を渡された)。届いた場面の不足は、合否にせず報告する */
export const exploring = given !== undefined;
