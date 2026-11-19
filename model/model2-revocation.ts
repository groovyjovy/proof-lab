// モデル2: 権限剥奪(P3 剥奪後の書き込み禁止)。tla/Revocation.tla と同じ状態空間になるように書く。
import type { Step } from "./check.ts";

type Role = "editor" | "none";
export type AuthSource = "cache" | "db";

type Req = { cookieRole: Role; afterRevoke: boolean };

export type State = {
  serverRole: Role;
  cachedRole: Role;
  pc: "idle" | "loaded" | "edited" | "sent" | "done";
  inflight: Req[];
  committed: boolean[];
};

export const init: State = { serverRole: "editor", cachedRole: "editor", pc: "idle", inflight: [], committed: [] };

export function steps(auth: AuthSource) {
  return (s: State): Step<State>[] => {
    const out: Step<State>[] = [];
    if (s.pc === "idle") out.push(["a-staffが読み込む", { ...s, pc: "loaded" }]);
    if (s.pc === "loaded") out.push(["a-staffが編集する", { ...s, pc: "edited" }]);
    if (s.pc === "edited") {
      const req: Req = { cookieRole: s.cachedRole, afterRevoke: s.serverRole === "none" };
      out.push([`a-staffが保存を送る(Cookieのrole=${s.cachedRole})`, { ...s, pc: "sent", inflight: [req] }]);
    }
    if (s.pc === "sent") {
      const req = s.inflight[0];
      const role = auth === "cache" ? req.cookieRole : s.serverRole;
      if (role === "editor")
        out.push([`サーバーが${auth}のrole=editorで保存を受理する`, { ...s, pc: "done", inflight: [], committed: [...s.committed, req.afterRevoke] }]);
      else
        out.push([`サーバーが${auth}のrole=noneで保存を拒否する`, { ...s, pc: "idle", inflight: [] }]);
    }
    if (s.serverRole === "editor") out.push(["管理者が剥奪する", { ...s, serverRole: "none" }]);
    if (s.cachedRole !== s.serverRole) out.push(["Cookie cacheが更新される", { ...s, cachedRole: s.serverRole }]);
    return out;
  };
}

// P3: 剥奪後に送られた保存は、一つもコミットされていない
export const p3 = (s: State) => s.committed.every((afterRevoke) => !afterRevoke);
