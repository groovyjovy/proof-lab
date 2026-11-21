import Spec.App

/-
画面の状態機械の性質の証明。範囲を区切らず、到達できるすべての状態について成り立つ。

閉じた系 `Sys` は、画面の状態と、まだ応答が届いていない副作用の列。
利用者は差し出された操作だけを行い(`Next.act`)、環境は飛んでいる副作用のどれかに、
ありうる応答のどれかを返す(`Next.deliver`)。地図ライブラリからの知らせは、いつでも届く(`Next.notice`)。
-/
set_option linter.unusedSimpArgs false

namespace App

open Domain

variable {P F : Type}

structure Sys (P F : Type) where
  app : State P F
  inflight : List (Effect P)

/-- 副作用 `e` に対して、環境が返しうる応答。 -/
inductive Answers : Effect P → Reply → Prop
  | loginOk : Answers (.login email) (.loginOk me)
  | loginFailed : Answers (.login email) (.loginFailed message)
  | logoutOk : Answers .logout .logoutOk
  | logoutFailed : Answers .logout .logoutFailed
  | saved : Answers (.save d a) .saved
  | rejected : Answers (.save d a) .rejected
  | unknown : Answers (.save d a) .unknown
  | identityChanged : Answers (.save d a) .identityChanged

inductive Next : Sys P F → Sys P F → Prop
  | act {sys : Sys P F} {op : Op P F} {st : Step P F} :
      perform sys.app op = some st → Next sys ⟨st.state, sys.inflight ++ st.effects⟩
  | deliver {sys : Sys P F} {pre post : List (Effect P)} {e : Effect P} {r : Reply}
      {st : Step P F} :
      sys.inflight = pre ++ e :: post → Answers e r → receive sys.app r = some st →
      Next sys ⟨st.state, pre ++ post ++ st.effects⟩
  | notice {sys : Sys P F} {n : Notice} :
      Next sys ⟨(notify sys.app n).state, sys.inflight ++ (notify sys.app n).effects⟩

inductive Reachable : Sys P F → Prop
  | init (me : Option Me) : Reachable ⟨init me, []⟩
  | step {s t : Sys P F} : Reachable s → Next s t → Reachable t

def Screen.draft? : Screen P F → Option (Draft P)
  | .view _ => none
  | .drawing d _ | .saving d | .unknown d _ | .resaving d => some d

/-- 結果が分からない(サーバーに保存されたかもしれない)下書き。 -/
def Screen.doubtful? : Screen P F → Option (Draft P)
  | .unknown d _ | .resaving d => some d
  | _ => none

/-- 保存中なら、その下書きの保存が、表示している本人として飛んでいる。 -/
def Session.inflight (s : Session P F) : List (Effect P) :=
  match s.screen with
  | .saving d | .resaving d => [.save d s.me.id]
  | _ => []

def State.session? : State P F → Option (Session P F)
  | .loggedIn s | .loggingOut s => some s
  | _ => none

def State.isSaving (s : State P F) : Bool :=
  match s with
  | .loggedIn s => s.screen.isSaving
  | _ => false

/-- 描画の権限: 下書きがあるのは編集できる人だけ。管理者以外は自分の市にしか描かない。 -/
def DraftOk (s : Session P F) : Prop :=
  ∀ d, s.screen.draft? = some d → s.me.canEdit = true ∧ (s.me.role ≠ .admin → d.city = s.me.home)

/-- 到達できる状態で成り立つ不変条件。飛んでいる副作用は、画面の状態だけで決まる。 -/
def Inv : Sys P F → Prop
  | ⟨.loggedOut _, fl⟩ => fl = []
  | ⟨.loggingIn email, fl⟩ => fl = [.login email]
  | ⟨.loggedIn s, fl⟩ => fl = s.inflight ∧ DraftOk s
  | ⟨.loggingOut s, fl⟩ => fl = [.logout] ∧ s.screen.isSaving = false ∧ DraftOk s

theorem singleton_split {pre post : List α} {e x : α} (h : pre ++ e :: post = [x]) :
    pre = [] ∧ e = x ∧ post = [] := by
  cases pre with
  | nil => simp_all
  | cons a rest => simp at h

theorem nil_split {pre post : List α} {e : α} (h : pre ++ e :: post = []) : False := by
  simp at h

theorem inv_init (me : Option Me) : Inv (⟨init me, []⟩ : Sys P F) := by
  cases me <;> simp [init, Inv, Session.inflight, DraftOk, Screen.draft?]

theorem inv_act {sys : Sys P F} {op : Op P F} {st : Step P F}
    (hinv : Inv sys) (h : perform sys.app op = some st) :
    Inv ⟨st.state, sys.inflight ++ st.effects⟩ := by
  obtain ⟨app, fl⟩ := sys
  cases app with
  | loggedOut err =>
    cases op <;> simp [perform] at h
    subst h; simp_all [Inv]
  | loggingIn _ => cases op <;> simp [perform] at h
  | loggingOut _ => cases op <;> simp [perform] at h
  | loggedIn s =>
    obtain ⟨me, tiles, screen⟩ := s
    simp only [Inv] at hinv
    obtain ⟨rfl, hok⟩ := hinv
    cases op <;> cases screen <;> simp [perform, onScreen, Screen.isSaving] at h
    all_goals (try split at h) <;> (try simp at h)
    all_goals first
      | subst h
      | obtain ⟨hc, rfl⟩ := h
    all_goals simp_all [Inv, Session.inflight, DraftOk, Screen.draft?, Session.to,
      Session.refreshed, Screen.isSaving]

theorem inv_deliver {sys : Sys P F} {pre post : List (Effect P)} {e : Effect P} {r : Reply}
    {st : Step P F} (hinv : Inv sys) (hfl : sys.inflight = pre ++ e :: post)
    (hans : Answers e r) (h : receive sys.app r = some st) :
    Inv ⟨st.state, pre ++ post ++ st.effects⟩ := by
  obtain ⟨app, fl⟩ := sys
  simp only at hfl
  subst hfl
  cases app with
  | loggedOut _ => simp [Inv] at hinv
  | loggingIn email =>
    simp [Inv] at hinv
    obtain ⟨rfl, rfl, rfl⟩ := singleton_split hinv
    cases hans <;> simp [receive] at h <;> subst h <;>
      simp [Inv, init, Session.inflight, DraftOk, Screen.draft?]
  | loggingOut s =>
    simp [Inv] at hinv
    obtain ⟨hfl, hsaving, hok⟩ := hinv
    obtain ⟨rfl, rfl, rfl⟩ := singleton_split hfl
    cases hans <;> simp [receive] at h <;> subst h <;> simp [Inv]
    obtain ⟨me, tiles, screen⟩ := s
    cases screen <;> simp_all [Session.inflight, Screen.isSaving]
  | loggedIn s =>
    obtain ⟨me, tiles, screen⟩ := s
    simp [Inv] at hinv
    obtain ⟨hfl, hok⟩ := hinv
    cases screen <;> simp [Session.inflight] at hfl
    all_goals first
      | exact (nil_split hfl).elim
      | (obtain ⟨rfl, rfl, rfl⟩ := singleton_split hfl
         cases hans <;> simp [receive, onReply] at h <;> subst h <;>
           simp_all [Session.to, Session.refreshed, Inv, Session.inflight, DraftOk, Screen.draft?])

theorem inv_notice {sys : Sys P F} {n : Notice} (hinv : Inv sys) :
    Inv ⟨(notify sys.app n).state, sys.inflight ++ (notify sys.app n).effects⟩ := by
  obtain ⟨app, fl⟩ := sys
  cases n
  cases app with
  | loggedIn s =>
    obtain ⟨me, tiles, screen⟩ := s
    simp only [Inv] at hinv
    obtain ⟨rfl, hok⟩ := hinv
    cases screen <;> simp [notify, Screen.isSaving, Inv, Session.inflight, hok]
  | _ => simpa [notify] using hinv

theorem reachable_inv {sys : Sys P F} (h : Reachable sys) : Inv sys := by
  induction h with
  | init me => exact inv_init me
  | step _ hnext ih =>
    cases hnext with
    | act h => exact inv_act ih h
    | deliver hfl hans h => exact inv_deliver ih hfl hans h
    | notice => exact inv_notice ih

/-! ## 性質 -/

/-- 応答を捨てない: 飛んでいる副作用への応答は、どれも今の状態で受け取れる。
    (保存中にログアウトできた最初の版では、これが破れて保存の結果が捨てられた。L1 の反例) -/
theorem replies_accepted {sys : Sys P F} {e : Effect P} {r : Reply}
    (h : Reachable sys) (he : e ∈ sys.inflight) (hans : Answers e r) :
    (receive sys.app r).isSome := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  cases app with
  | loggedOut _ =>
    simp only [Inv] at hinv
    simp [hinv] at he
  | loggingIn _ =>
    simp only [Inv] at hinv
    simp [hinv] at he
    subst he
    cases hans <;> simp [receive]
  | loggingOut s =>
    simp only [Inv] at hinv
    simp [hinv.1] at he
    subst he
    cases hans <;> simp [receive]
  | loggedIn s =>
    obtain ⟨me, tiles, screen⟩ := s
    simp only [Inv] at hinv
    rw [hinv.1] at he
    cases screen <;> simp [Session.inflight] at he <;> subst he <;>
      cases hans <;> simp [receive, onReply]

/-- 飛んでいる副作用は高々1つ。だから応答に「どの副作用の応答か」を書かなくてよい。 -/
theorem single_flight {sys : Sys P F} (h : Reachable sys) : sys.inflight.length ≤ 1 := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  cases app with
  | loggedOut _ => simp_all [Inv]
  | loggingIn _ => simp_all [Inv]
  | loggingOut _ => simp_all [Inv]
  | loggedIn s =>
    obtain ⟨me, tiles, screen⟩ := s
    simp [Inv] at hinv
    obtain ⟨rfl, _⟩ := hinv
    cases screen <;> simp [Session.inflight]

/-- 描画の権限: 到達できる状態では、下書きは編集できる人にしかなく、市職員の下書きは自分の市。 -/
theorem draft_permission {sys : Sys P F} {s : Session P F} (h : Reachable sys)
    (hs : sys.app.session? = some s) : DraftOk s := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  cases app <;> simp [State.session?] at hs <;> subst hs <;> simp_all [Inv]

/-- P6 UIの排他: 保存中は描画開始を差し出さない。到達できるかに関係なく、どの状態でも。 -/
theorem p6 (s : State P F) (key : String) (h : s.isSaving = true) :
    perform s (.startDrawing key) = none := by
  cases s with
  | loggedIn s =>
    obtain ⟨me, tiles, screen⟩ := s
    cases screen <;> simp_all [State.isSaving, Screen.isSaving, perform, onScreen]
  | _ => simp [State.isSaving] at h

/-- L1 の状態機械の側: 保存中に保存の応答を受け取れば、必ず保存中を抜ける。
    保存中にはその保存がちょうど1つ飛んでいて(`reachable_inv`)、応答はどれも受け取れる
    (`replies_accepted`)。残る「副作用はいつか必ず応答する」は実行時の責務で、
    src/lib/app/effects.ts のタイムアウトが受け持つ(証明ではなくテストで確かめる)。 -/
theorem l1_exit {s : State P F} {d : Draft P} {r : Reply} {st : Step P F}
    {a : String} (hans : Answers (.save d a) r) (h : receive s r = some st) :
    st.state.isSaving = false := by
  cases s with
  | loggedIn s =>
    obtain ⟨me, tiles, screen⟩ := s
    cases screen <;> cases hans <;> simp [receive, onReply] at h <;> subst h <;>
      simp [Session.to, Session.refreshed, State.isSaving, Screen.isSaving]
  | _ => cases hans <;> simp [receive] at h

def State.doubtful? (s : State P F) : Option (Draft P) := s.session?.bind (·.screen.doubtful?)
def State.draft? (s : State P F) : Option (Draft P) := s.session?.bind (·.screen.draft?)

/-- P10 の状態機械の側(1): 結果が分からない下書きは、操作では変わらない。操作のあとも同じ下書きの
    まま結果が分からないか、下書きそのものがなくなる。保存を送るなら、その下書きそのもの。 -/
theorem p10_perform {s : State P F} {op : Op P F} {st : Step P F} {d : Draft P}
    (hd : s.doubtful? = some d) (h : perform s op = some st) :
    (st.state.doubtful? = some d ∨ st.state.draft? = none) ∧
      ∀ d' a, Effect.save d' a ∈ st.effects → d' = d := by
  cases s with
  | loggedIn sess =>
    obtain ⟨me, tiles, screen⟩ := sess
    cases screen <;> simp [State.doubtful?, State.session?, Screen.doubtful?] at hd <;> subst hd <;>
      cases op <;> simp [perform, onScreen, Screen.isSaving] at h <;> subst h <;>
      simp [State.doubtful?, State.draft?, State.session?, Session.to, Session.refreshed,
        Screen.doubtful?, Screen.draft?]
  | loggingOut _ => cases op <;> simp [perform] at h
  | _ => simp [State.doubtful?, State.session?] at hd

/-- P10 の状態機械の側(2): 応答でも変わらない。応答を受け取っても副作用は出さない。 -/
theorem p10_receive {s : State P F} {r : Reply} {st : Step P F} {d : Draft P}
    (hd : s.doubtful? = some d) (h : receive s r = some st) :
    (st.state.doubtful? = some d ∨ st.state.draft? = none) ∧ st.effects = [] := by
  cases s with
  | loggedIn sess =>
    obtain ⟨me, tiles, screen⟩ := sess
    cases screen <;> simp [State.doubtful?, State.session?, Screen.doubtful?] at hd <;> subst hd <;>
      cases r <;> simp [receive, onReply] at h <;> subst h <;>
      simp [State.doubtful?, State.draft?, State.session?, Session.to, Session.refreshed,
        Screen.doubtful?, Screen.draft?]
  | loggingOut sess =>
    cases r <;> simp [receive] at h <;> subst h <;>
      simp_all [State.doubtful?, State.draft?, State.session?]
  | _ => simp [State.doubtful?, State.session?] at hd

/-- P10 の状態機械の側(3): 結果が分からなくなった下書きは、保存中に送った下書きそのもの。
    (1)(2) と合わせて、同じキーで送る中身はいつも同じ。サーバーは同じキーを1つしか保存しない
    ので、何度送り直しても地物は1つ。キーは描画開始のたびに新しく作る(画面が UUID を渡す)。 -/
theorem p10_enter {sess : Session P F} {d : Draft P} {st : Step P F}
    (hs : sess.screen = .saving d ∨ sess.screen = .resaving d)
    (h : receive (.loggedIn sess) .unknown = some st) : st.state.doubtful? = some d := by
  obtain ⟨me, tiles, screen⟩ := sess
  rcases hs with hs | hs <;> simp at hs <;> subst hs <;> simp [receive, onReply] at h <;>
    subst h <;> simp [State.doubtful?, State.session?, Session.to, Screen.doubtful?]

/-- P10 の状態機械の側(4): 知らせでも変わらない。 -/
theorem p10_notify {s : State P F} {n : Notice} {d : Draft P} (hd : s.doubtful? = some d) :
    (notify s n).state.doubtful? = some d ∨ (notify s n).state.draft? = none := by
  cases n
  cases s with
  | loggedIn sess =>
    obtain ⟨me, tiles, screen⟩ := sess
    cases screen <;> simp_all [notify, Screen.isSaving, State.doubtful?, State.draft?,
      State.session?, Screen.doubtful?]
  | _ => simp_all [notify]

/-- P11 の状態機械の側: 飛んでいる保存は、どれも画面が今表示している本人として送られている。
    サーバーは、要求に書いた本人とセッションの本人が違えば答えない(`Authz.p11`)。 -/
theorem requests_carry_identity {sys : Sys P F} {d : Draft P} {a : String} (h : Reachable sys)
    (he : Effect.save d a ∈ sys.inflight) : ∃ s, sys.app = .loggedIn s ∧ a = s.me.id := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  cases app with
  | loggedIn s =>
    obtain ⟨me, tiles, screen⟩ := s
    simp only [Inv] at hinv
    rw [hinv.1] at he
    cases screen <;> simp [Session.inflight] at he
    all_goals exact ⟨_, rfl, he.2⟩
  | loggedOut _ => simp only [Inv] at hinv; simp [hinv] at he
  | loggingIn _ => simp only [Inv] at hinv; simp [hinv] at he
  | loggingOut _ => simp only [Inv] at hinv; simp [hinv.1] at he

/-- 差し出すかどうかは状態だけで決まり、操作の中身(座標・キー・市など)には左右されない。
    だから画面は「今押せるか」を状態から決められる。 -/
theorem offer_depends_on_kind_only (s : State P F) (op₁ op₂ : Op P F)
    (hk : op₁.kind = op₂.kind) : (perform s op₁).isSome = (perform s op₂).isSome := by
  cases op₁ <;> cases op₂ <;> simp [Op.kind] at hk <;>
    cases s <;> simp [perform] <;>
    (try rename_i s; obtain ⟨me, tiles, screen⟩ := s; cases screen <;> simp [onScreen]) <;>
    (try split <;> simp)

end App
