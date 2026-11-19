// モデル1: 二人の同時編集(P4 ロストアップデートなし)。付録Aをそのまま移したもの。
import type { Step } from "./check.ts";

const clients = ["A", "B"] as const;
type Client = (typeof clients)[number];

type ClientState =
  | { pc: "待機" }
  | { pc: "編集中" | "保存待ち"; local: Client[]; ver: number }
  | { pc: "完了" };

export type State = { server: { edits: Client[]; ver: number } } & Record<Client, ClientState>;

export const init: State = { server: { edits: [], ver: 0 }, A: { pc: "待機" }, B: { pc: "待機" } };

export function steps(useVersion: boolean) {
  return (s: State): Step<State>[] => {
    const out: Step<State>[] = [];
    for (const c of clients) {
      const me = s[c];
      if (me.pc === "待機")
        out.push([`${c}が読み込む`, { ...s, [c]: { pc: "編集中", local: s.server.edits, ver: s.server.ver } }]);
      if (me.pc === "編集中")
        out.push([`${c}が編集する`, { ...s, [c]: { ...me, pc: "保存待ち", local: [...me.local, c] } }]);
      if (me.pc === "保存待ち") {
        if (!useVersion || me.ver === s.server.ver)
          out.push([`${c}が保存する`, { ...s, server: { edits: me.local, ver: s.server.ver + 1 }, [c]: { pc: "完了" } }]);
        else
          out.push([`${c}の保存が競合で拒否され、読み直す`, { ...s, [c]: { pc: "待機" } }]);
      }
    }
    return out;
  };
}

// P4: 二人とも完了したら、両方の編集が残っている
export const p4 = (s: State) =>
  !(s.A.pc === "完了" && s.B.pc === "完了") || (s.server.edits.includes("A") && s.server.edits.includes("B"));
