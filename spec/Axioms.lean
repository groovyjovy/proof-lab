import Spec

/-
性質を表す定理が、Lean の標準の公理(`propext`・`Quot.sound`・`Classical.choice`)だけに依存し、
書きかけの証明(`sorryAx`)などに依存していないことを確かめる。tests/conformance/axioms.test.ts が
`lake env lean Axioms.lean` で実行し、出力を読む。性質の定理を足したら、ここにも足す。
-/

-- 画面の状態機械(spec/Spec/AppProofs.lean)
#print axioms App.replies_accepted
#print axioms App.lane_single_flight
#print axioms App.l1_exit
#print axioms App.receive_only_searches
#print axioms App.draft_permission
#print axioms App.p6
#print axioms App.p10_perform
#print axioms App.p10_receive
#print axioms App.p10_enter
#print axioms App.p10_notify
#print axioms App.requests_carry_identity
#print axioms App.p4_ops_keep_version
#print axioms App.p4_no_update_after_conflict
#print axioms App.p12_resend_same
#print axioms App.p12_unknown_keeps
#print axioms App.offer_depends_on_kind_only
#print axioms App.p13_only_latest
#print axioms App.p13_shown_ok
#print axioms App.p13_settled
#print axioms App.p13_pending_inflight

-- 認可とサーバー(spec/Spec/AuthzProofs.lean)
#print axioms Authz.p1
#print axioms Authz.p2
#print axioms Authz.p7
#print axioms Authz.p8_needs_permission
#print axioms Authz.p8_own_city
#print axioms Authz.p8_no_move
#print axioms Authz.p3_db
#print axioms Authz.p3_cache_counterexample
#print axioms Authz.p4_second_rejected
#print axioms Authz.p4_kept
#print axioms Authz.p12_replay
#print axioms Authz.p10_server
#print axioms Authz.p11
