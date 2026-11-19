----------------------------- MODULE Revocation -----------------------------
(* モデル2: 権限剥奪 (P3 剥奪後の書き込み禁止)。                            *)
(* model/model2-revocation.ts と同じ状態空間になるように書く。              *)
EXTENDS Naturals, Sequences

CONSTANT AuthSource      \* 保存の認可に使う role の出どころ: "cache" | "db"

VARIABLES serverRole,    \* DB 上の role
          cachedRole,    \* Cookie cache 上の role
          pc,            \* a-staff の位置
          inflight,      \* 送信済みで未処理の保存リクエスト (長さ 0 か 1)
          committed      \* コミットされた保存ごとの afterRevoke (履歴変数)

vars == <<serverRole, cachedRole, pc, inflight, committed>>

Roles == {"editor", "none"}
Req == [cookieRole : Roles, afterRevoke : BOOLEAN]

TypeOK ==
  /\ serverRole \in Roles
  /\ cachedRole \in Roles
  /\ pc \in {"idle", "loaded", "edited", "sent", "done"}
  /\ inflight \in Seq(Req) /\ Len(inflight) <= 1
  /\ committed \in Seq(BOOLEAN)

Init ==
  /\ serverRole = "editor"
  /\ cachedRole = "editor"
  /\ pc = "idle"
  /\ inflight = <<>>
  /\ committed = <<>>

Load ==
  /\ pc = "idle"
  /\ pc' = "loaded"
  /\ UNCHANGED <<serverRole, cachedRole, inflight, committed>>

Edit ==
  /\ pc = "loaded"
  /\ pc' = "edited"
  /\ UNCHANGED <<serverRole, cachedRole, inflight, committed>>

Send ==
  /\ pc = "edited"
  /\ pc' = "sent"
  /\ inflight' = <<[cookieRole |-> cachedRole, afterRevoke |-> serverRole = "none"]>>
  /\ UNCHANGED <<serverRole, cachedRole, committed>>

AuthorizedRole(req) == IF AuthSource = "cache" THEN req.cookieRole ELSE serverRole

Accept ==
  /\ pc = "sent"
  /\ AuthorizedRole(Head(inflight)) = "editor"
  /\ pc' = "done"
  /\ inflight' = <<>>
  /\ committed' = Append(committed, Head(inflight).afterRevoke)
  /\ UNCHANGED <<serverRole, cachedRole>>

Reject ==
  /\ pc = "sent"
  /\ AuthorizedRole(Head(inflight)) = "none"
  /\ pc' = "idle"
  /\ inflight' = <<>>
  /\ UNCHANGED <<serverRole, cachedRole, committed>>

Revoke ==
  /\ serverRole = "editor"
  /\ serverRole' = "none"
  /\ UNCHANGED <<cachedRole, pc, inflight, committed>>

RefreshCache ==
  /\ cachedRole # serverRole
  /\ cachedRole' = serverRole
  /\ UNCHANGED <<serverRole, pc, inflight, committed>>

Next == Load \/ Edit \/ Send \/ Accept \/ Reject \/ Revoke \/ RefreshCache

Spec == Init /\ [][Next]_vars

\* P3: 剥奪後に送られた保存は、一つもコミットされていない
P3 == \A i \in DOMAIN committed : ~committed[i]
=============================================================================
