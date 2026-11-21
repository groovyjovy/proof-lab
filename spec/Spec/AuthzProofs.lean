import Spec.Authz

/-
認可の性質の証明。利用者と地物のすべての組み合わせについて成り立つ。
-/
namespace Authz

open Domain

/-- P1 地域分離: 市職員が読める地物は、担当の市のものだけ。 -/
theorem p1 (u : User) (f : Feature) (c : City) (hc : u.role.city? = some c)
    (h : canRead u f = true) : f.city = c := by
  obtain ⟨role, canEdit⟩ := u
  obtain ⟨city, isPublic⟩ := f
  cases role <;> cases city <;> cases c <;> simp_all [canRead, Role.city?]

/-- P2 属性秘匿: 閲覧者には `owner_name` を返さない。 -/
theorem p2 (u : User) (h : u.role = .viewer) : seesOwner u = false := by
  simp [seesOwner, h]

/-- P7 公開範囲: 閲覧者が読める地物は、公開の地物だけ。 -/
theorem p7 (u : User) (f : Feature) (hv : u.role = .viewer) (h : canRead u f = true) :
    f.isPublic = true := by
  obtain ⟨role, canEdit⟩ := u
  obtain ⟨city, isPublic⟩ := f
  simp at hv; subst hv
  cases city <;> simp_all [canRead, Role.city?]

/-- P8 書き込みの地域分離(1): 書き込めるのは編集権限がある人だけ。閲覧者は何も書き込めない。 -/
theorem p8_needs_permission (u : User) (c : City) (h : canWrite u c = true) :
    u.canEdit = true ∧ u.role ≠ .viewer := by
  obtain ⟨role, canEdit⟩ := u
  cases role <;> cases c <;> simp_all [canWrite, Role.city?]

/-- P8 書き込みの地域分離(2): 市職員が書き込めるのは担当の市だけ。 -/
theorem p8_own_city (u : User) (c home : City) (hc : u.role.city? = some home)
    (h : canWrite u c = true) : c = home := by
  obtain ⟨role, canEdit⟩ := u
  cases role <;> cases c <;> cases home <;> simp_all [canWrite, Role.city?]

/-- P8 書き込みの地域分離(3): 市職員は、自分の市の地物を他市へ移せない(編集の前と後の両方を見る)。 -/
theorem p8_no_move (u : User) (before after : Feature) (home : City)
    (hc : u.role.city? = some home) (h : canUpdate u before after = true) :
    before.city = home ∧ after.city = home := by
  simp [canUpdate] at h
  exact ⟨p8_own_city u _ home hc h.1, p8_own_city u _ home hc h.2⟩

/-- 剥奪の後かどうかと DB の値の関係。どんな順序で起きても保たれる。 -/
theorem revoked_db (w : World) (es : List Event) (hw : w.revoked = true → w.db = false) :
    (w.run es).revoked = true → (w.run es).db = false := by
  induction es generalizing w with
  | nil => exact hw
  | cons e es ih =>
    apply ih
    cases e <;> simp_all [World.step]

/-- P3 剥奪後の書き込み禁止: 保存を DB の編集権限で認可するなら、剥奪のあとの保存は、
    Cookie cache がいつ更新されても(されなくても)拒否される。 -/
theorem p3_db (es : List Event) (h : (World.start.run es).revoked = true) :
    allows .db (World.start.run es) = false := by
  simp only [allows]
  exact revoked_db World.start es (by simp [World.start]) h

/-- P3 の反例: Cookie cache の値で認可すると、剥奪の直後(cache が更新される前)の保存が通る。
    モデル2・TLA+ の反例と同じ手順。 -/
theorem p3_cache_counterexample :
    (World.start.run [.revoke]).revoked = true ∧ allows .cache (World.start.run [.revoke]) = true := by
  decide

/-- P4 ロストアップデートなし(1): 同じ版を読んだ二人のうち、先に保存した人の保存が通ったら、
    後の人の保存は通らない(読み直してから保存し直す)。 -/
theorem p4_second_rejected (r r₁ : Row) (e₁ e₂ : String) (h : r.save r.version e₁ = some r₁) :
    r₁.save r.version e₂ = none := by
  simp [Row.save] at h
  subst h
  simp [Row.save]

/-- P4 ロストアップデートなし(2): 保存が通っても、それまでの編集は消えない。 -/
theorem p4_kept (r r' : Row) (v : Nat) (e : String) (h : r.save v e = some r') :
    r'.edits = r.edits ++ [e] := by
  simp [Row.save] at h
  obtain ⟨_, rfl⟩ := h
  rfl

/-- P10 作成の冪等性: 同じキーで何度作成しても、キーごとに行は1つ。 -/
theorem p10_server {α : Type} (store : List (String × α)) (key : String) (v : α)
    (h : (store.map Prod.fst).Nodup) : ((create store key v).map Prod.fst).Nodup := by
  unfold create
  split
  · exact h
  · rename_i hnot
    simp at hnot
    simp [List.nodup_append, h]
    intro a x hmem heq
    subst heq
    exact hnot x hmem

/-- P11 画面とサーバーの本人の一致: サーバーが答えるのは、要求に書いた本人とセッションの本人が
    同じときだけ。画面は、表示している本人を要求に書く(`App.requests_carry_identity`、
    タイルの URL の `as`)。だから画面に出る応答は、表示している本人として認可されたもの。 -/
theorem p11 (requested session : String) (h : served requested session = true) :
    session = requested := by
  simp [served] at h
  exact h.symm

end Authz
