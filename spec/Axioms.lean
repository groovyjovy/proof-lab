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
#print axioms App.notice_keeps_busy
#print axioms App.p14_other_stream_ignored
#print axioms App.p14_stale_only_newer
#print axioms App.p14_unknown_resolved_applied
#print axioms App.p14_update_success_applied
#print axioms App.p15_commit_permitted
#print axioms App.p15_save_edit_permitted
#print axioms App.p15_selected_readable
#print axioms App.p15_listing_since
#print axioms App.p15_change_applied
#print axioms App.p15_other_user_ignored
#print axioms App.p15_same_permission_ignored
#print axioms App.p15_resend_rejected_unknown
#print axioms App.p16_start_keeps_tile_version
#print axioms App.p16_edit_matches_tile
#print axioms App.boundary_wrong_version_clears_draft
#print axioms App.boundary_move_requires_verified_version
#print axioms App.boundary_commit_versions
#print axioms App.p17_save_boundary_verified

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
