------------------------------- MODULE DrawUI -------------------------------
(* 付録B の編集UI と、保存リクエストの通信路。L1 (保存中はいつか必ず終わる) を検査する。 *)
(* 点の座標は L1 に関係しないので、点の数だけを持つ。                                  *)
EXTENDS Naturals

CONSTANTS MaxPoints,     \* 点の数の上限 (状態空間を有限にするため。確定には 3 点必要)
          HasTimeout     \* 保存中にタイムアウトのイベントがあるか

VARIABLES kind,          \* "view" (閲覧) | "drawing" (描画中) | "saving" (保存中)
          points,        \* 描画中の点の数
          net            \* 保存リクエスト: "idle" | "inflight" (応答待ち) | "lost" (応答が失われた)

vars == <<kind, points, net>>

TypeOK ==
  /\ kind \in {"view", "drawing", "saving"}
  /\ points \in 0..MaxPoints
  /\ net \in {"idle", "inflight", "lost"}

Init == kind = "view" /\ points = 0 /\ net = "idle"

\* ---- ユーザーのイベント (付録B の next と同じ遷移) ----
Start    == kind = "view" /\ kind' = "drawing" /\ points' = 0 /\ UNCHANGED net
AddPoint == kind = "drawing" /\ points < MaxPoints /\ points' = points + 1 /\ UNCHANGED <<kind, net>>
Commit   == kind = "drawing" /\ points >= 3 /\ kind' = "saving" /\ net' = "inflight" /\ UNCHANGED points
Cancel   == kind = "drawing" /\ kind' = "view" /\ points' = 0 /\ UNCHANGED net

\* ---- サーバーの応答と通信路 ----
Succeed == kind = "saving" /\ net = "inflight" /\ kind' = "view" /\ points' = 0 /\ net' = "idle"
Fail    == kind = "saving" /\ net = "inflight" /\ kind' = "drawing" /\ net' = "idle" /\ UNCHANGED points
Lose    == net = "inflight" /\ net' = "lost" /\ UNCHANGED <<kind, points>>

\* ---- UI のタイマー (保存失敗と同じく描画中に戻す。遅れて届く応答は捨てる) ----
Timeout == HasTimeout /\ kind = "saving" /\ kind' = "drawing" /\ net' = "idle" /\ UNCHANGED points

Next == Start \/ AddPoint \/ Commit \/ Cancel \/ Succeed \/ Fail \/ Lose \/ Timeout

\* 公平性の仮定:
\*  - サーバーは、応答待ちのリクエストにいつか応答する      WF(Succeed \/ Fail)
\*  - タイマーは、保存中が続くならいつか発火する           WF(Timeout)
\*  - ユーザーの操作と通信路での喪失には仮定を置かない      (何もしない・失われる、の両方がありうる)
Spec == Init /\ [][Next]_vars /\ WF_vars(Succeed \/ Fail) /\ WF_vars(Timeout)

\* L1: 保存中になったら、いつか必ず保存中でなくなる
L1 == kind = "saving" ~> kind # "saving"
=============================================================================
