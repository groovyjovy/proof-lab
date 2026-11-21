import Spec.App

/-
画面の状態機械の性質の証明。範囲を区切らず、到達できるすべての状態について成り立つ。

閉じた系 `Sys` は、画面の状態と、まだ応答が届いていない副作用の列。
利用者は差し出された操作だけを行い(`Next.act`)、環境は飛んでいる副作用のどれかに、
ありうる応答のどれかを返す(`Next.deliver`)。どの副作用に先に応答するかは決めていないので、
応答の順序の入れ替わりも含まれる。地図からの知らせは、いつでも届く(`Next.notice`)。

サーバーについての前提は `Server` にまとめた。証明はどんな前提でも成り立ち、性質の中身がこれで決まる。
- 範囲の検索の結果は、サーバーが本人 `a` に返してよいもの(`ok a`)だけとする。認可の仕様と RLS が
  「読める地物だけ」を返すこと(spec/Spec/Authz.lean と tests/properties)と合わせると、一覧には
  今の本人が読める地物しか出ない(`p13_shown_ok`)
- 更新の成功と変更の知らせは、効いた(commit された)要求のキー(`applied`)についてだけ届くとする。
  サーバーは、キーに版を書き込むとき(更新が効いたとき)に知らせ、PostgreSQL の知らせは commit
  するまで届かない(db/migrations/005_change_notice.sql)
-/
set_option linter.unusedSimpArgs false

namespace App

open Domain

/-- サーバーについての前提。 -/
structure Server (F : Type) where
  /-- 本人 `a` への検索に返してよい結果 -/
  ok : String → List (Ref × F) → Prop
  /-- キー `k` の要求が効いて commit された -/
  applied : String → Prop

variable {P F : Type} {server : Server F} {ok : String → List (Ref × F) → Prop}

structure Sys (P F : Type) where
  app : State P F
  inflight : List (Effect P)

/-- 副作用 `e` に対して、環境が返しうる応答。 -/
inductive Answers (server : Server F) : Effect P → Reply F → Prop
  | loginOk : Answers server (.login email) (.loginOk me)
  | loginFailed : Answers server (.login email) (.loginFailed message)
  | logoutOk : Answers server .logout .logoutOk
  | logoutFailed : Answers server .logout .logoutFailed
  | saved : Answers server (.save d a) .saved
  | rejected : Answers server (.save d a) .rejected
  | unknown : Answers server (.save d a) .unknown
  | identityChanged : Answers server (.save d a) .identityChanged
  | loaded : Answers server (.load n a) (.loaded e)
  | loadFailed : Answers server (.load n a) .loadFailed
  | loadIdentityChanged : Answers server (.load n a) .identityChanged
  | updated : server.applied k → Answers server (.update e k a) .saved
  | updateRejected : Answers server (.update e k a) .rejected
  | updateUnknown : Answers server (.update e k a) .unknown
  | updateConflict : Answers server (.update e k a) .conflict
  | updateIdentityChanged : Answers server (.update e k a) .identityChanged
  | found : server.ok a hits → Answers server (.search q a) (.searched q.seq (.found hits))
  | searchFailed : Answers server (.search q a) (.searched q.seq .failed)
  | searchIdentityChanged : Answers server (.search q a) (.searched q.seq .identityChanged)

/-- 環境が送りうる知らせ。変更の知らせは、効いたキーのものだけ。 -/
def NoticeOk (server : Server F) : Notice P → Prop
  | .changed c => server.applied c.key
  | _ => True

inductive Next (server : Server F) : Sys P F → Sys P F → Prop
  | act {sys : Sys P F} {op : Op P F} {st : Step P F} :
      perform sys.app op = some st → Next server sys ⟨st.state, sys.inflight ++ st.effects⟩
  | deliver {sys : Sys P F} {pre post : List (Effect P)} {e : Effect P} {r : Reply F}
      {st : Step P F} :
      sys.inflight = pre ++ e :: post → Answers server e r → receive sys.app r = some st →
      Next server sys ⟨st.state, pre ++ post ++ st.effects⟩
  | notice {sys : Sys P F} {n : Notice P} :
      NoticeOk server n → Next server sys ⟨(notify sys.app n).state, sys.inflight ++ (notify sys.app n).effects⟩

inductive Reachable (server : Server F) : Sys P F → Prop
  | init (me : Option Me) : Reachable server ⟨init me, []⟩
  | step {s t : Sys P F} : Reachable server s → Next server s t → Reachable server t

def Screen.draft? : Screen P F → Option (Draft P)
  | .drawing d _ | .saving d | .unknown d _ | .resaving d => some d
  | _ => none

/-- 編集中の値(読み込んだあと)。 -/
def Screen.edit? : Screen P F → Option Edit
  | .editing e _ _ | .updating e _ _ | .updateUnknown e _ _ | .reupdating e _ _ | .conflicted e =>
    some e
  | _ => none

/-- 結果が分からない(サーバーに保存されたかもしれない)下書き。 -/
def Screen.doubtful? : Screen P F → Option (Draft P)
  | .unknown d _ | .resaving d => some d
  | _ => none

/-- 応答を待っているなら、その副作用が、表示している本人として飛んでいる(検索のほか)。 -/
def Session.inflight (s : Session P F) : List (Effect P) :=
  match s.screen with
  | .saving d | .resaving d => [.save d s.me.id]
  | .loading ref => [.load ref.id s.me.id]
  | .updating e key _ | .reupdating e key _ => [.update e key s.me.id]
  | _ => []

def State.session? : State P F → Option (Session P F)
  | .loggedIn s | .loggingOut s => some s
  | _ => none

def State.isBusy (s : State P F) : Bool :=
  match s with
  | .loggedIn s => s.screen.isBusy
  | _ => false

/-- ポップアップの地物は、今の本人が読める(P15)。
    (事例研究3までは「下書きがあるのは、編集できる人だけ」(`SelectedOk`)を不変条件にしていた。ログインの途中で
    権限が変わると、描いていた下書きは残るので成り立たない。送るときの権限で決める定理に言い直した) -/
def SelectedOk (s : Session P F) : Prop :=
  ∀ sel, s.screen = .view (some sel) → canReadFeature s.me sel.ref = true

/-- 一覧と待っている検索は、今の権限で振った番号(`since` から)のもの(P15)。 -/
def SinceOk (s : Session P F) : Prop :=
  s.search.since ≤ s.map.issued ∧ (∀ q, s.search.pending = some q → s.search.since ≤ q.seq) ∧
    (∀ l, s.search.shown = some l → s.search.since ≤ l.query.seq)

/-! ## 飛んでいる副作用の2つの列

検索のほかの副作用(ログイン・ログアウト・保存・読み込み・更新)は、応答を待ってから次を送るので
高々1つ(`lane`)。検索は応答を待たずに次を送るので、いくつも飛ぶ。 -/

/-- 検索の番号。検索でなければ `none`。 -/
def Effect.seq? : Effect P → Option Nat
  | .search q _ => some q.seq
  | _ => none

/-- 検索のほかの、飛んでいる副作用。 -/
def lane (fl : List (Effect P)) : List (Effect P) := fl.filter (fun e => e.seq?.isNone)

/-- 飛んでいる検索の番号。 -/
def seqs (fl : List (Effect P)) : List Nat := fl.filterMap Effect.seq?

/-- 飛んでいる検索の番号は送った順に増えていて、どれもまだ振っていない番号より小さい。
    だから、番号が同じなら同じ要求(`search_unique`)。 -/
def SearchesOk (issued : Nat) (fl : List (Effect P)) : Prop :=
  (seqs fl).Pairwise (· < ·) ∧ ∀ n ∈ seqs fl, n < issued

/-- 一覧の不変条件。
    - 待っている検索は、今見えている範囲のもので、今の本人として飛んでいる
    - 待っていなければ、一覧は今見えている範囲のもの
    - 一覧に出している結果は、今の本人に返してよいもの -/
def ListingOk (ok : String → List (Ref × F) → Prop) (s : Session P F) (fl : List (Effect P)) :
    Prop :=
  (∀ q, s.search.pending = some q → some q.area = s.map.area ∧ Effect.search q s.me.id ∈ fl) ∧
  (s.search.pending = none → s.search.shown.map (·.query.area) = s.map.area) ∧
  (∀ q hits, s.search.shown = some (.found q hits) → ok s.me.id hits)

/-- ログアウト中は一覧を止めている。範囲が分からないうちは、検索も一覧もない。
    一覧に出している結果は、今の本人に返してよいもの。 -/
def FrozenOk (ok : String → List (Ref × F) → Prop) (s : Session P F) : Prop :=
  (s.map.area = none → s.search.pending = none ∧ s.search.shown = none) ∧
  (∀ q hits, s.search.shown = some (.found q hits) → ok s.me.id hits)

/-- 更新を送って(送り直して)いる間に、効いたという知らせを受けたキー。 -/
@[simp] def Screen.appliedKey? : Screen P F → Option String
  | .updating _ k true | .reupdating _ k true => some k
  | _ => none

/-- 効いたと覚えている更新のキーは、本当に効いている。 -/
def UpdatingOk (server : Server F) (s : Session P F) : Prop :=
  ∀ k, s.screen.appliedKey? = some k → server.applied k

/-- 到達できる状態で成り立つ不変条件。検索のほかの飛んでいる副作用は、画面の状態だけで決まる。 -/
def Inv (server : Server F) : Sys P F → Prop
  | ⟨.loggedOut _ m, fl⟩ => lane fl = [] ∧ SearchesOk m.issued fl
  | ⟨.loggingIn email m, fl⟩ => lane fl = [.login email] ∧ SearchesOk m.issued fl
  | ⟨.loggedIn s, fl⟩ =>
    lane fl = s.inflight ∧ SearchesOk s.map.issued fl ∧ SelectedOk s ∧ ListingOk server.ok s fl ∧
      UpdatingOk server s ∧ SinceOk s
  | ⟨.loggingOut s, fl⟩ =>
    lane fl = [.logout] ∧ SearchesOk s.map.issued fl ∧ s.screen.isBusy = false ∧ SelectedOk s ∧
      FrozenOk server.ok s ∧ SinceOk s

/-! ## 列についての補題 -/

@[simp] theorem lane_append (a b : List (Effect P)) : lane (a ++ b) = lane a ++ lane b := by
  simp [lane]

@[simp] theorem seqs_append (a b : List (Effect P)) : seqs (a ++ b) = seqs a ++ seqs b := by
  simp [seqs]

@[simp] theorem searchesOk_append_search {i : Nat} {fl : List (Effect P)} {area : Area P}
    {a : String} : SearchesOk (i + 1) (fl ++ [.search ⟨i, area⟩ a]) ↔ SearchesOk i fl := by
  have h1 : seqs [Effect.search (⟨i, area⟩ : Query P) a] = [i] := rfl
  simp only [SearchesOk, seqs_append, h1, List.pairwise_append]
  constructor
  · rintro ⟨⟨hp, -, hcross⟩, -⟩
    exact ⟨hp, fun n hn => hcross n hn i (by simp)⟩
  · rintro ⟨hp, hlt⟩
    refine ⟨⟨hp, by simp, fun n hn b hb => ?_⟩, fun n hn => ?_⟩
    · simp at hb; subst hb; exact hlt n hn
    · simp at hn
      rcases hn with hn | rfl
      · exact Nat.lt_succ_of_lt (hlt n hn)
      · exact Nat.lt_succ_self _

theorem SearchesOk.remove {i : Nat} {pre post : List (Effect P)} {e : Effect P}
    (h : SearchesOk i (pre ++ e :: post)) : SearchesOk i (pre ++ post) := by
  obtain ⟨hp, hlt⟩ := h
  have hsub : List.Sublist (seqs (pre ++ post)) (seqs (pre ++ e :: post)) :=
    List.Sublist.filterMap _ (by simp)
  exact ⟨hp.sublist hsub, fun n hn => hlt n (hsub.subset hn)⟩

theorem mem_seqs {fl : List (Effect P)} {q : Query P} {a : String}
    (h : Effect.search q a ∈ fl) : q.seq ∈ seqs fl :=
  List.mem_filterMap.2 ⟨_, h, rfl⟩

/-- 飛んでいる検索は、番号が同じなら同じ要求。 -/
theorem search_unique {fl : List (Effect P)} (hp : (seqs fl).Pairwise (· < ·)) {q q' : Query P}
    {a a' : String} (h₁ : Effect.search q a ∈ fl) (h₂ : Effect.search q' a' ∈ fl)
    (hs : q.seq = q'.seq) : q = q' ∧ a = a' := by
  induction fl with
  | nil => simp at h₁
  | cons x rest ih =>
    cases x with
    | search qx ax =>
      simp only [seqs, List.filterMap_cons, Effect.seq?, List.pairwise_cons] at hp
      obtain ⟨hhead, hrest⟩ := hp
      simp only [List.mem_cons, Effect.search.injEq] at h₁ h₂
      rcases h₁ with ⟨rfl, rfl⟩ | h₁ <;> rcases h₂ with ⟨rfl, rfl⟩ | h₂
      · exact ⟨rfl, rfl⟩
      · exact absurd (hhead _ (mem_seqs h₂)) (by omega)
      · exact absurd (hhead _ (mem_seqs h₁)) (by omega)
      · exact ih hrest h₁ h₂
    | _ =>
      simp only [seqs, List.filterMap_cons, Effect.seq?] at hp
      simp only [List.mem_cons, reduceCtorEq, false_or] at h₁ h₂
      exact ih hp h₁ h₂

theorem lane_mem {fl : List (Effect P)} {e : Effect P} (h : e ∈ fl) (he : e.seq? = none) :
    e ∈ lane fl := by
  simp [lane, h, he]

theorem lane_split {pre post : List (Effect P)} {e : Effect P} (he : e.seq? = none) :
    lane (pre ++ e :: post) = lane pre ++ e :: lane post := by
  simp [lane, List.filter_cons, he]

/-- 検索のほかの副作用が1つだけ飛んでいるなら、それに応答すると、検索のほかは何も飛んでいない。 -/
theorem lane_single {pre post : List (Effect P)} {e x : Effect P} (he : e.seq? = none)
    (h : lane (pre ++ e :: post) = [x]) : e = x ∧ lane (pre ++ post) = [] := by
  rw [lane_split he] at h
  rcases hpre : lane pre with _ | ⟨y, ys⟩ <;> rw [hpre] at h
  · simp at h
    obtain ⟨rfl, hpost⟩ := h
    simp [hpre, hpost]
  · simp at h

theorem lane_nonempty {pre post : List (Effect P)} {e : Effect P} (he : e.seq? = none)
    (h : lane (pre ++ e :: post) = []) : False := by
  rw [lane_split he] at h
  simp at h

@[simp] theorem lane_nil : lane ([] : List (Effect P)) = [] := rfl
@[simp] theorem seqs_nil : seqs ([] : List (Effect P)) = [] := rfl

@[simp] theorem lane_cons (e : Effect P) (l : List (Effect P)) :
    lane (e :: l) = if e.seq?.isNone then e :: lane l else lane l := by
  simp only [lane, List.filter_cons]

@[simp] theorem seqs_cons (e : Effect P) (l : List (Effect P)) :
    seqs (e :: l) = e.seq?.toList ++ seqs l := by
  cases h : e.seq? <;> simp [seqs, List.filterMap_cons, h]

@[simp] theorem searchesOk_append_lane {i : Nat} {fl effs : List (Effect P)}
    (he : seqs effs = []) : SearchesOk i (fl ++ effs) ↔ SearchesOk i fl := by
  simp [SearchesOk, he]

theorem lane_split_search {pre post : List (Effect P)} {q : Query P} {a : String} :
    lane (pre ++ .search q a :: post) = lane (pre ++ post) := by
  simp [Effect.seq?]

theorem ListingOk.append {s : Session P F} {fl : List (Effect P)} (effs : List (Effect P))
    (h : ListingOk ok s fl) : ListingOk ok s (fl ++ effs) := by
  obtain ⟨hp, hn, hs⟩ := h
  exact ⟨fun q hq => ⟨(hp q hq).1, List.mem_append_left _ (hp q hq).2⟩, hn, hs⟩

/-- 一覧の不変条件は、本人・地図・一覧だけで決まる(画面やタイルが変わっても保たれる)。 -/
theorem ListingOk.mono {s s' : Session P F} {fl fl' : List (Effect P)} (h : ListingOk ok s fl)
    (hme : s'.me = s.me) (hmap : s'.map = s.map) (hsearch : s'.search = s.search)
    (hfl : ∀ x, x ∈ fl → x ∈ fl') : ListingOk ok s' fl' := by
  obtain ⟨hp, hn, hs⟩ := h
  rw [← hme, ← hmap, ← hsearch] at *
  exact ⟨fun q hq => ⟨(hp q hq).1, hfl _ (hp q hq).2⟩, hn, hs⟩

theorem ListingOk.remove {s : Session P F} {pre post : List (Effect P)} {e : Effect P}
    (h : ListingOk ok s (pre ++ e :: post))
    (he : ∀ q, s.search.pending = some q → e ≠ .search q s.me.id) :
    ListingOk ok s (pre ++ post) := by
  obtain ⟨hp, hn, hs⟩ := h
  refine ⟨fun q hq => ⟨(hp q hq).1, ?_⟩, hn, hs⟩
  have hm := (hp q hq).2
  have hne := he q hq
  simp only [List.mem_append, List.mem_cons] at hm ⊢
  rcases hm with hm | rfl | hm
  · exact Or.inl hm
  · exact absurd rfl hne
  · exact Or.inr hm

theorem ListingOk.remove_lane {s : Session P F} {pre post : List (Effect P)} {e : Effect P}
    (h : ListingOk ok s (pre ++ e :: post)) (he : e.seq? = none) :
    ListingOk ok s (pre ++ post) :=
  h.remove fun q _ hq => by subst hq; simp [Effect.seq?] at he

theorem ListingOk.frozen {s : Session P F} {fl : List (Effect P)} (h : ListingOk ok s fl) :
    FrozenOk ok s := by
  obtain ⟨hp, hn, hs⟩ := h
  refine ⟨fun harea => ?_, hs⟩
  cases hpend : s.search.pending with
  | some q =>
    have := (hp q hpend).1
    rw [harea] at this
    simp at this
  | none =>
    have := hn hpend
    rw [harea] at this
    simpa using this

theorem updatingOk_of_not_busy {s : Session P F} (h : s.screen.isBusy = false) :
    UpdatingOk server s := by
  intro k hk
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
  cases screen <;> simp_all [Screen.appliedKey?, Screen.isBusy]

theorem inflight_of_not_busy {s : Session P F} (h : s.screen.isBusy = false) : s.inflight = [] := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
  cases screen <;> simp_all [Session.inflight, Screen.isBusy]

/-! ## 不変条件 -/

theorem inv_init (me : Option Me) : Inv server (⟨init me, []⟩ : Sys P F) := by
  cases me <;> simp [init, Inv, Session.fresh, Session.inflight, SelectedOk, SinceOk, Screen.draft?,
    SearchesOk, ListingOk, UpdatingOk]

/-- 範囲を検索して画面 `screen` に移る遷移は、不変条件を保つ。 -/
theorem inv_searchTo {s : Session P F} {screen : Screen P F} {fl : List (Effect P)}
    (hlane : lane fl = ({ s with screen } : Session P F).inflight)
    (hsearch : SearchesOk s.map.issued fl)
    (hok : SelectedOk ({ s with screen } : Session P F))
    (hfrozen : FrozenOk server.ok s) (hupd : UpdatingOk server ({ s with screen } : Session P F))
    (hsince : SinceOk s) :
    Inv server ⟨(s.searchTo screen).state, fl ++ (s.searchTo screen).effects⟩ := by
  obtain ⟨me, tiles, screen₀, ⟨area, issued⟩, ⟨pending, shown, since⟩, mapLag⟩ := s
  obtain ⟨hnone, hshown⟩ := hfrozen
  cases area with
  | none =>
    simp at hnone
    obtain ⟨rfl, rfl⟩ := hnone
    simp_all [Session.searchTo, Session.to, Inv, ListingOk, Session.inflight, SelectedOk, UpdatingOk,
      SinceOk]
  | some area =>
    simp_all [Session.searchTo, Session.to, Inv, ListingOk, Session.inflight, SelectedOk,
      Effect.seq?, UpdatingOk, SinceOk]
    omega

theorem inv_act {sys : Sys P F} {op : Op P F} {st : Step P F}
    (hinv : Inv server sys) (h : perform sys.app op = some st) :
    Inv server ⟨st.state, sys.inflight ++ st.effects⟩ := by
  obtain ⟨app, fl⟩ := sys
  cases app with
  | loggedOut err m =>
    cases op <;> simp [perform] at h
    subst h; simp_all [Inv, Effect.seq?]
  | loggingIn _ _ => cases op <;> simp [perform] at h
  | loggingOut _ => cases op <;> simp [perform] at h
  | loggedIn s =>
    simp only [Inv] at hinv
    obtain ⟨hlane, hsearch, hok, hlist, hupd, hsince⟩ := hinv
    have hfrozen := hlist.frozen
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
    cases op <;> cases screen <;> simp [perform, onScreen, Screen.isBusy, Session.refreshTo] at h
    all_goals (try split at h) <;> (try simp at h)
    all_goals first
      | subst h
      | obtain ⟨hc, rfl⟩ := h
    all_goals first
      | (apply inv_searchTo <;>
           simp_all [Session.inflight, SelectedOk, SinceOk, Screen.draft?, FrozenOk, UpdatingOk] <;> done)
      | (simp only [Inv]
         refine ⟨?_, ?_, ?_, ?_, hfrozen, hsince⟩ <;>
           simp_all [Session.inflight, SelectedOk, SinceOk, Screen.draft?, Screen.isBusy, Effect.seq?] <;> done)
      | (simp only [Inv, Session.to]
         refine ⟨?_, ?_, ?_, hlist.mono rfl rfl rfl (fun x hx => List.mem_append_left _ hx), ?_⟩ <;>
           simp_all [Session.inflight, SelectedOk, SinceOk, Screen.draft?, Screen.isBusy, Effect.seq?,
             UpdatingOk] <;> (try (intro sel x y _ h e; subst e; exact h)) <;> done)

/-- 検索のほかの副作用への応答は、不変条件を保つ。 -/
theorem inv_deliver_lane {app : State P F} {pre post : List (Effect P)} {e : Effect P}
    {r : Reply F} {st : Step P F} (hinv : Inv server ⟨app, pre ++ e :: post⟩) (he : e.seq? = none)
    (hans : Answers server e r) (h : receive app r = some st) :
    Inv server ⟨st.state, pre ++ post ++ st.effects⟩ := by
  cases app with
  | loggedOut _ _ =>
    simp only [Inv] at hinv
    exact (lane_nonempty he hinv.1).elim
  | loggingIn email m =>
    simp only [Inv] at hinv
    obtain ⟨hl, hs⟩ := hinv
    obtain ⟨rfl, hl⟩ := lane_single he hl
    have hs := hs.remove
    cases hans <;> simp [receive] at h <;> subst h
    · apply inv_searchTo <;> simp_all [Session.fresh, Session.inflight, SelectedOk, SinceOk, Screen.draft?,
        FrozenOk, UpdatingOk]
    · simp_all [Inv, Effect.seq?]
  | loggingOut sess =>
    simp only [Inv] at hinv
    obtain ⟨hl, hs, hbusy, hok, hfrozen, hsince⟩ := hinv
    obtain ⟨rfl, hl⟩ := lane_single he hl
    have hs := hs.remove
    cases hans <;> simp [receive] at h <;> subst h
    · simp_all [Inv]
    · apply inv_searchTo <;> simp_all [inflight_of_not_busy hbusy, updatingOk_of_not_busy hbusy]
  | loggedIn sess =>
    simp only [Inv] at hinv
    obtain ⟨hl, hs, hok, hlist, hupd, hsince⟩ := hinv
    have hs := hs.remove
    have hlist' := hlist.remove_lane he
    have hfrozen := hlist.frozen
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
    cases screen <;> simp only [Session.inflight] at hl
    all_goals first
      | exact (lane_nonempty he hl).elim
      | (obtain ⟨rfl, hl⟩ := lane_single he hl
         cases hans <;> simp [receive, onReply, Screen.isBusy, Session.refreshTo] at h <;>
           (try split at h) <;> (try simp only [Option.some.injEq] at h) <;> subst h)
    all_goals first
      | (apply inv_searchTo <;>
           simp_all [Session.inflight, SelectedOk, SinceOk, Screen.draft?, FrozenOk, UpdatingOk] <;> done)
      | (simp only [Inv] at *; simp_all; done)
      | (simp only [Inv, Session.to]
         refine ⟨?_, ?_, ?_, hlist'.mono rfl rfl rfl (fun x hx => List.mem_append_left _ hx), ?_⟩ <;>
           simp_all [Session.inflight, SelectedOk, SinceOk, Screen.draft?, Screen.isBusy, UpdatingOk] <;> done)

/-- 検索の応答は、不変条件を保つ。いちばん新しい検索への応答なら一覧を替え、ほかは何も変えない。 -/
theorem inv_deliver_search {app : State P F} {pre post : List (Effect P)} {q : Query P}
    {a : String} {r : SearchResult F} {st : Step P F}
    (hinv : Inv server ⟨app, pre ++ .search q a :: post⟩) (hr : ∀ hits, r = .found hits → server.ok a hits)
    (h : receive app (.searched q.seq r) = some st) :
    Inv server ⟨st.state, pre ++ post ++ st.effects⟩ := by
  cases app with
  | loggedOut _ _ =>
    simp [receive] at h; subst h
    simp only [Inv, lane_split_search, List.append_nil] at hinv ⊢
    exact ⟨hinv.1, hinv.2.remove⟩
  | loggingIn _ _ =>
    simp [receive] at h; subst h
    simp only [Inv, lane_split_search, List.append_nil] at hinv ⊢
    exact ⟨hinv.1, hinv.2.remove⟩
  | loggingOut _ =>
    simp [receive] at h; subst h
    simp only [Inv, lane_split_search, List.append_nil] at hinv ⊢
    obtain ⟨hl, hs, hb, hok, hf, hsince⟩ := hinv
    exact ⟨hl, hs.remove, hb, hok, hf, hsince⟩
  | loggedIn sess =>
    simp only [Inv, lane_split_search] at hinv
    obtain ⟨hl, hs, hok, hlist, hupd, hsince⟩ := hinv
    have hs' := hs.remove
    obtain ⟨me, tiles, screen, map, ⟨pending, shown, since⟩, mapLag⟩ := sess
    obtain ⟨hsi, hsp, hss⟩ := hsince
    simp only [receive, onSearched, Option.some.injEq] at h
    subst h
    cases hpend : pending with
    | none =>
      subst hpend
      simp only [Inv, List.append_nil]
      exact ⟨hl, hs', hok, hlist.remove (fun q' hq' => by simp at hq'), hupd, hsi, hsp, hss⟩
    | some q' =>
      subst hpend
      by_cases hseq : q'.seq = q.seq
      · -- いちばん新しい検索への応答。番号が同じなので、同じ要求(今の本人として送ったもの)
        obtain ⟨hpend, -, -⟩ := hlist
        obtain ⟨harea, hmem⟩ := hpend q' rfl
        simp only at harea hmem
        obtain ⟨rfl, rfl⟩ := search_unique hs.1 hmem
          (show Effect.search q a ∈ pre ++ Effect.search q a :: post by simp) hseq
        cases r with
        | found hits =>
          simp only [hseq, ↓reduceIte, Inv, List.append_nil]
          refine ⟨hl, hs', hok, ⟨fun _ h => by simp at h, fun _ => by simpa [Listing.query] using harea,
            fun q'' hits'' h => ?_⟩, hupd, hsi, fun _ h => by simp at h,
            fun l h => by simp at h; subst h; exact hsp _ rfl⟩
          simp at h
          obtain ⟨rfl, rfl⟩ := h
          exact hr _ rfl
        | failed =>
          simp only [hseq, ↓reduceIte, Inv, List.append_nil]
          exact ⟨hl, hs', hok, ⟨fun _ h => by simp at h, fun _ => by simpa [Listing.query] using harea,
            fun _ _ h => by simp at h⟩, hupd, hsi, fun _ h => by simp at h,
            fun l h => by simp at h; subst h; exact hsp _ rfl⟩
        | identityChanged =>
          simp only [hseq, ↓reduceIte]
          split
          · simp only [Inv, List.append_nil]
            exact ⟨hl, hs', hok, ⟨fun _ h => by simp at h,
              fun _ => by simpa [Listing.query] using harea, fun _ _ h => by simp at h⟩, hupd, hsi,
              fun _ h => by simp at h, fun l h => by simp at h; subst h; exact hsp _ rfl⟩
          · rename_i hbusy
            simp only [Inv, List.append_nil]
            refine ⟨?_, hs'⟩
            rw [hl]
            exact inflight_of_not_busy (by simpa using hbusy)
      · -- 古い検索への応答。何も変えない
        simp only [hseq, ↓reduceIte, Inv, List.append_nil]
        refine ⟨hl, hs', hok, hlist.remove (fun q'' hq'' heq => ?_), hupd, hsi, hsp, hss⟩
        simp at hq''
        subst hq''
        simp at heq
        exact hseq (by rw [heq.1])

theorem inv_deliver {sys : Sys P F} {pre post : List (Effect P)} {e : Effect P} {r : Reply F}
    {st : Step P F} (hinv : Inv server sys) (hfl : sys.inflight = pre ++ e :: post)
    (hans : Answers server e r) (h : receive sys.app r = some st) :
    Inv server ⟨st.state, pre ++ post ++ st.effects⟩ := by
  obtain ⟨app, fl⟩ := sys
  simp only at hfl
  subst hfl
  by_cases hs : e.seq? = none
  · exact inv_deliver_lane hinv hs hans h
  · cases hans with
    | found hok => exact inv_deliver_search hinv (fun _ h => by cases h; exact hok) h
    | searchFailed => exact inv_deliver_search hinv (fun _ h => by cases h) h
    | searchIdentityChanged => exact inv_deliver_search hinv (fun _ h => by cases h) h
    | _ => simp [Effect.seq?] at hs

theorem inv_notice {sys : Sys P F} {n : Notice P} (hinv : Inv server sys)
    (hn : NoticeOk server n) :
    Inv server ⟨(notify sys.app n).state, sys.inflight ++ (notify sys.app n).effects⟩ := by
  obtain ⟨app, fl⟩ := sys
  cases n with
  | tilesIdentityChanged =>
    cases app with
    | loggedIn s =>
      simp only [Inv] at hinv
      obtain ⟨hl, hs, hok, hlist, hupd, hsince⟩ := hinv
      simp only [notify]
      split
      · simpa [Inv] using ⟨hl, hs, hok, hlist, hupd, hsince⟩
      · rename_i hbusy
        simp only [Inv, List.append_nil]
        exact ⟨by rw [hl]; exact inflight_of_not_busy (by simpa using hbusy), hs⟩
    | _ => simpa [notify] using hinv
  | mapMoved area =>
    cases app with
    | loggedOut _ _ => simpa [notify, Inv, MapView.movedTo] using hinv
    | loggingIn _ _ => simpa [notify, Inv, MapView.movedTo] using hinv
    | loggingOut s =>
      simp only [Inv] at hinv
      obtain ⟨hl, hs, hb, hok, ⟨-, hshown⟩, hsince⟩ := hinv
      simp only [notify, Inv, List.append_nil]
      exact ⟨hl, hs, hb, hok, ⟨fun h => by simp [MapView.movedTo] at h, hshown⟩,
        by simpa [SinceOk, MapView.movedTo] using hsince⟩
    | loggedIn s =>
      simp only [Inv] at hinv
      obtain ⟨hl, hs, hok, hlist, hupd, hsince⟩ := hinv
      have hfrozen := hlist.frozen
      simp only [notify]
      apply inv_searchTo
      · exact hl
      · exact hs
      · exact hok
      · exact ⟨fun h => by simp [MapView.movedTo] at h, hfrozen.2⟩
      · exact hupd
      · simpa [SinceOk, MapView.movedTo] using hsince
  | changed c =>
    cases app with
    | loggedIn s =>
      simp only [Inv] at hinv
      obtain ⟨hl, hs, hok, hlist, hupd, hsince⟩ := hinv
      have hfrozen := hlist.frozen
      simp only [notify]
      split
      · rename_i hactor
        obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
        cases screen <;> simp only [onChanged, Session.refreshTo] <;> (try split)
        all_goals first
          | (apply inv_searchTo <;>
               simp_all [Session.inflight, SelectedOk, SinceOk, Screen.draft?, UpdatingOk, Screen.isBusy,
                 FrozenOk] <;> done)
          | (rename_i hkey
             simp only [Inv, Session.to, List.append_nil]
             refine ⟨by simpa [Session.inflight] using hl, hs, by simp [SelectedOk], hlist, ?_, hsince⟩
             intro k hk
             simp at hk
             subst hk
             simpa [NoticeOk, hkey] using hn)
      · simpa [Inv] using ⟨hl, hs, hok, hlist, hupd, hsince⟩
    | _ => simpa [notify] using hinv
  | resumed actor =>
    cases app with
    | loggedIn s =>
      simp only [Inv] at hinv
      obtain ⟨hl, hs, hok, hlist, hupd, hsince⟩ := hinv
      have hfrozen := hlist.frozen
      simp only [notify]
      split
      · simp only [Session.refreshTo]
        apply inv_searchTo <;> simp_all [Session.inflight, SelectedOk, UpdatingOk, FrozenOk, SinceOk]
      · simpa [Inv] using ⟨hl, hs, hok, hlist, hupd, hsince⟩
    | _ => simpa [notify] using hinv
  | permissionChanged me' =>
    cases app with
    | loggedIn s =>
      simp only [Inv] at hinv
      obtain ⟨hl, hs, hok, hlist, hupd, hsince⟩ := hinv
      have hfrozen := hlist.frozen
      simp only [notify]
      split
      · rename_i hid
        obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
        simp only at hid
        cases screen <;> simp only [Session.withPermission, Session.refreshTo] <;> apply inv_searchTo <;>
          simp_all [Session.inflight, SelectedOk, SinceOk, UpdatingOk, FrozenOk, Screen.isBusy]
      · simpa [Inv] using ⟨hl, hs, hok, hlist, hupd, hsince⟩
    | loggingOut s =>
      simp only [Inv] at hinv
      obtain ⟨hl, hs, hb, hok, hf, hsince⟩ := hinv
      simp only [notify]
      split
      · obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
        cases screen <;> simp_all [Inv, Session.withPermission, SelectedOk, SinceOk, FrozenOk,
          Screen.isBusy]
      · simpa [Inv] using ⟨hl, hs, hb, hok, hf, hsince⟩
    | _ => simpa [notify] using hinv

theorem reachable_inv {sys : Sys P F} (h : Reachable server sys) : Inv server sys := by
  induction h with
  | init me => exact inv_init me
  | step _ hnext ih =>
    cases hnext with
    | act h => exact inv_act ih h
    | deliver hfl hans h => exact inv_deliver ih hfl hans h
    | notice hn => exact inv_notice ih hn

/-! ## 性質 -/

/-- 応答を捨てない: 飛んでいる副作用への応答は、どれも今の状態で受け取れる。
    検索の応答は、前のセッションで送ったものでも、どの状態でも受け取る。
    (保存中にログアウトできた最初の版では、これが破れて保存の結果が捨てられた。L1 の反例) -/
theorem replies_accepted {sys : Sys P F} {e : Effect P} {r : Reply F}
    (h : Reachable server sys) (he : e ∈ sys.inflight) (hans : Answers server e r) :
    (receive sys.app r).isSome := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  by_cases hs : e.seq? = none
  · have hl := lane_mem he hs
    cases app with
    | loggedOut _ _ => simp only [Inv] at hinv; rw [hinv.1] at hl; simp at hl
    | loggingIn _ _ =>
      simp only [Inv] at hinv; rw [hinv.1] at hl; simp at hl; subst hl
      cases hans <;> simp [receive]
    | loggingOut _ =>
      simp only [Inv] at hinv; rw [hinv.1] at hl; simp at hl; subst hl
      cases hans <;> simp [receive]
    | loggedIn s =>
      obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
      simp only [Inv] at hinv
      rw [hinv.1] at hl
      cases screen <;> simp [Session.inflight] at hl <;> subst hl <;> cases hans <;>
        simp [receive, onReply, Screen.isBusy] <;> split <;> rfl
  · cases hans <;> simp [Effect.seq?] at hs <;> cases app <;> simp [receive]

/-- 検索のほかの副作用は、飛んでいるのは高々1つ。だから、その応答には「どの副作用の応答か」を書かなくてよい。
    検索は同時にいくつも飛ぶので、応答に番号を書く(`Reply.searched`)。 -/
theorem lane_single_flight {sys : Sys P F} (h : Reachable server sys) :
    (lane sys.inflight).length ≤ 1 := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  cases app with
  | loggedIn s =>
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
    simp only [Inv] at hinv
    rw [hinv.1]
    cases screen <;> simp [Session.inflight]
  | _ => simp only [Inv] at hinv; simp [hinv.1]

/-- P6 UIの排他: 保存中は描画開始を差し出さない。到達できるかに関係なく、どの状態でも。 -/
theorem p6 (s : State P F) (key : String) (h : s.isBusy = true) :
    perform s (.startDrawing key) = none := by
  cases s with
  | loggedIn s =>
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
    cases screen <;> simp_all [State.isBusy, Screen.isBusy, perform, onScreen]
  | _ => simp [State.isBusy] at h

theorem searchTo_state (s : Session P F) (screen : Screen P F) :
    ∃ s', (s.searchTo screen).state = .loggedIn s' ∧ s'.screen = screen ∧ s'.me = s.me := by
  unfold Session.searchTo
  split <;> exact ⟨_, rfl, rfl, rfl⟩

@[simp high] theorem searchTo_isBusy (s : Session P F) (screen : Screen P F) :
    (s.searchTo screen).state.isBusy = screen.isBusy := by
  obtain ⟨s', h, hs, -⟩ := searchTo_state s screen
  simp [h, State.isBusy, hs]

@[simp high] theorem mem_searchTo_effects {s : Session P F} {screen : Screen P F} {e : Effect P} :
    e ∈ (s.searchTo screen).effects ↔
      ∃ area, s.map.area = some area ∧ e = .search ⟨s.map.issued, area⟩ s.me.id := by
  unfold Session.searchTo
  split <;> simp_all [Session.to, eq_comm]

theorem onSearched_effects (s : Session P F) (seq : Nat) (r : SearchResult F) :
    (onSearched s seq r).effects = [] := by
  unfold onSearched
  split <;> (try split) <;> (try split) <;> (try split) <;> rfl

/-- L1 の状態機械の側: 応答を待っている副作用(保存・読み込み・更新)の応答を受け取れば、
    必ず応答待ちを抜ける。応答を待っているときはその副作用がちょうど1つ飛んでいて
    (`reachable_inv`)、応答はどれも受け取れる(`replies_accepted`)。残る「副作用はいつか必ず応答する」は
    実行時の責務で、src/lib/app/effects.ts のタイムアウトが受け持つ(証明ではなくテストで確かめる)。 -/
theorem l1_exit {s : Session P F} {e : Effect P} {r : Reply F} {st : Step P F}
    (he : e ∈ s.inflight) (hans : Answers server e r) (h : receive (.loggedIn s) r = some st) :
    st.state.isBusy = false := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
  cases screen <;> simp [Session.inflight] at he <;> subst he <;> cases hans <;>
    simp [receive, onReply, Screen.isBusy, Session.refreshTo] at h <;> (try split at h) <;>
    (try simp only [Option.some.injEq] at h) <;>
    subst h <;> (try rw [searchTo_isBusy]) <;> simp [Session.to, State.isBusy, Screen.isBusy]

/-- 応答を受け取って出す副作用は、検索だけ。保存などを送るのは、利用者の操作だけ。
    検索の応答は、副作用を何も出さない。 -/
theorem receive_only_searches {s : State P F} {r : Reply F} {st : Step P F}
    (h : receive s r = some st) : ∀ e ∈ st.effects, e.seq?.isSome := by
  cases r with
  | searched seq res =>
    cases s <;> simp [receive] at h <;> subst h <;> simp [onSearched_effects]
  | _ =>
    cases s with
    | loggedIn sess =>
      obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
      cases screen <;> simp [receive, onReply, Screen.isBusy, Session.refreshTo] at h <;>
        (try split at h) <;> (try simp only [Option.some.injEq] at h) <;>
        (try subst h) <;> (try simp [Session.to]) <;> exact fun e _ _ _ he => by subst he; rfl
    | _ => simp [receive] at h <;> (try subst h) <;> (try simp) <;>
        exact fun e _ _ _ he => by subst he; rfl

def State.doubtful? (s : State P F) : Option (Draft P) := s.session?.bind (·.screen.doubtful?)
def State.draft? (s : State P F) : Option (Draft P) := s.session?.bind (·.screen.draft?)
def State.edit? (s : State P F) : Option Edit := s.session?.bind (·.screen.edit?)

@[simp high] theorem searchTo_doubtful? (s : Session P F) (screen : Screen P F) :
    (s.searchTo screen).state.doubtful? = screen.doubtful? := by
  obtain ⟨s', h, hs, -⟩ := searchTo_state s screen
  simp [h, State.doubtful?, State.session?, hs]

@[simp high] theorem searchTo_draft? (s : Session P F) (screen : Screen P F) :
    (s.searchTo screen).state.draft? = screen.draft? := by
  obtain ⟨s', h, hs, -⟩ := searchTo_state s screen
  simp [h, State.draft?, State.session?, hs]

@[simp high] theorem searchTo_edit? (s : Session P F) (screen : Screen P F) :
    (s.searchTo screen).state.edit? = screen.edit? := by
  obtain ⟨s', h, hs, -⟩ := searchTo_state s screen
  simp [h, State.edit?, State.session?, hs]

/-- 検索して画面を移る遷移(`searchTo`)の結果を、画面の状態の言葉に直す。
    `State.doubtful?` などを展開する前に使う(展開すると、これらの補題が当たらなくなる)。 -/
macro "simp_searchTo" : tactic =>
  `(tactic| simp only [searchTo_doubtful?, searchTo_draft?, searchTo_edit?, searchTo_isBusy,
    mem_searchTo_effects])

/-- P10 の状態機械の側(1): 結果が分からない下書きは、操作では変わらない。操作のあとも同じ下書きの
    まま結果が分からないか、下書きそのものがなくなる。保存を送るなら、その下書きそのもの。 -/
theorem p10_perform {s : State P F} {op : Op P F} {st : Step P F} {d : Draft P}
    (hd : s.doubtful? = some d) (h : perform s op = some st) :
    (st.state.doubtful? = some d ∨ st.state.draft? = none) ∧
      ∀ d' a, Effect.save d' a ∈ st.effects → d' = d := by
  cases s with
  | loggedIn sess =>
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
    cases screen <;> simp [State.doubtful?, State.session?, Screen.doubtful?] at hd <;> subst hd <;>
      cases op <;> simp [perform, onScreen, Screen.isBusy, Session.refreshTo] at h <;> subst h <;>
      (try simp_searchTo) <;>
      simp [State.doubtful?, State.draft?, State.session?, Session.to, Screen.doubtful?,
        Screen.draft?]
  | loggingOut _ => cases op <;> simp [perform] at h
  | _ => simp [State.doubtful?, State.session?] at hd

/-- P10 の状態機械の側(2): 応答でも変わらない。応答を受け取って出すのは検索だけ。 -/
theorem p10_receive {s : State P F} {r : Reply F} {st : Step P F} {d : Draft P}
    (hd : s.doubtful? = some d) (h : receive s r = some st) :
    (st.state.doubtful? = some d ∨ st.state.draft? = none) ∧ ∀ e ∈ st.effects, e.seq?.isSome := by
  refine ⟨?_, receive_only_searches h⟩
  cases s with
  | loggedIn sess =>
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
    cases screen <;> simp [State.doubtful?, State.session?, Screen.doubtful?] at hd <;> subst hd <;>
      cases r <;> simp [receive, onReply, Screen.isBusy, Session.refreshTo] at h <;> subst h
    all_goals first
      | (simp only [searchTo_doubtful?, searchTo_draft?]; simp [Screen.draft?]; done)
      | (simp [State.doubtful?, State.draft?, State.session?, Session.to, Screen.doubtful?,
          Screen.draft?]; done)
      | (unfold onSearched
         split <;> (try split) <;> (try split) <;>
           simp [State.doubtful?, State.draft?, State.session?, Screen.doubtful?, Screen.draft?,
             Screen.isBusy] at *)
  | loggingOut sess =>
    cases r <;> simp [receive] at h <;> subst h <;> (try simp_searchTo) <;>
      simp_all [State.doubtful?, State.draft?, State.session?]
  | _ => simp [State.doubtful?, State.session?] at hd

/-- P10 の状態機械の側(3): 結果が分からなくなった下書きは、保存中に送った下書きそのもの。
    (1)(2) と合わせて、同じキーで送る中身はいつも同じ。サーバーは同じキーを1つしか保存しない
    ので、何度送り直しても地物は1つ。キーは描画開始のたびに新しく作る(画面が UUID を渡す)。 -/
theorem p10_enter {sess : Session P F} {d : Draft P} {st : Step P F}
    (hs : sess.screen = .saving d ∨ sess.screen = .resaving d)
    (h : receive (.loggedIn sess) .unknown = some st) : st.state.doubtful? = some d := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
  rcases hs with hs | hs <;> simp at hs <;> subst hs <;> simp [receive, onReply, Screen.isBusy] at h <;>
    subst h <;> simp [State.doubtful?, State.session?, Session.to, Screen.doubtful?]

/-- P10 の状態機械の側(4): 知らせでも変わらない。 -/
theorem p10_notify {s : State P F} {n : Notice P} {d : Draft P} (hd : s.doubtful? = some d) :
    (notify s n).state.doubtful? = some d ∨ (notify s n).state.draft? = none := by
  cases n with
  | tilesIdentityChanged =>
    cases s with
    | loggedIn sess =>
      obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
      cases screen <;> simp_all [notify, Screen.isBusy, State.doubtful?, State.draft?,
        State.session?, Screen.doubtful?]
    | _ => simp_all [notify]
  | mapMoved area =>
    cases s <;> simp only [notify] <;> (try simp_searchTo) <;>
      simp_all [State.doubtful?, State.draft?, State.session?]
  | permissionChanged me' =>
    cases s with
    | loggedIn sess =>
      obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
      simp only [notify]
      split
      · cases screen <;> simp [State.doubtful?, State.session?, Screen.doubtful?] at hd <;> subst hd <;>
          simp only [Session.withPermission, Session.refreshTo] <;> simp_searchTo <;>
          simp [Screen.doubtful?]
      · simp_all
    | loggingOut sess =>
      obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
      simp only [notify]
      split
      · cases screen <;> simp_all [State.doubtful?, State.draft?, State.session?,
          Session.withPermission, Screen.doubtful?]
      · simp_all
    | _ => simp_all [notify]
  | changed c =>
    cases s with
    | loggedIn sess =>
      obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
      simp only [notify]
      split
      · cases screen <;> simp [State.doubtful?, State.session?, Screen.doubtful?] at hd <;> subst hd <;>
          simp only [onChanged, Session.refreshTo] <;> (try split) <;> simp_searchTo <;>
          simp [Screen.doubtful?]
      · simp_all
    | _ => simp_all [notify]
  | resumed actor =>
    cases s with
    | loggedIn sess =>
      simp only [notify]
      split
      · simp only [Session.refreshTo]; simp_searchTo; simp_all [State.doubtful?, State.session?]
      · simp_all
    | _ => simp_all [notify]

/-- データの要求に書いた本人。ログイン・ログアウトには書かない。 -/
def Effect.actor? : Effect P → Option String
  | .save _ a | .load _ a | .update _ _ a | .search _ a => some a
  | _ => none

/-- P11 の状態機械の側: 検索のほかのデータの要求(保存・読み込み・更新)は、飛んでいるならどれも、画面が
    今表示している本人として送られている。サーバーは、要求に書いた本人とセッションの本人が違えば
    答えない(`Authz.p11`)。検索は前の本人として送ったものも飛んでいるので、ここには含めない
    (いちばん新しい検索は今の本人として飛んでいる: `p13_pending_inflight`)。 -/
theorem requests_carry_identity {sys : Sys P F} {e : Effect P} {a : String}
    (h : Reachable server sys) (he : e ∈ lane sys.inflight) (ha : e.actor? = some a) :
    ∃ s, sys.app = .loggedIn s ∧ a = s.me.id := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  cases app with
  | loggedIn s =>
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
    simp only [Inv] at hinv
    rw [hinv.1] at he
    cases screen <;> simp [Session.inflight] at he <;> subst he <;> simp [Effect.actor?] at ha
    all_goals exact ⟨_, rfl, ha.symm⟩
  | loggedOut _ _ => simp only [Inv] at hinv; simp [hinv.1] at he
  | loggingIn _ _ =>
    simp only [Inv] at hinv; simp [hinv.1] at he; subst he; simp [Effect.actor?] at ha
  | loggingOut _ =>
    simp only [Inv] at hinv; simp [hinv.1] at he; subst he; simp [Effect.actor?] at ha

/-- P4 の画面の側(1): 編集中の地物と版は、どの操作でも変わらない(変えられるのは名前と備考だけ)。
    編集の値は、読み込みの応答(`loaded`)でしか生まれないので、更新に書く版はサーバーから読んだもの。 -/
theorem p4_ops_keep_version {s : State P F} {op : Op P F} {st : Step P F} {e' : Edit}
    (h : perform s op = some st) (he' : st.state.edit? = some e') :
    ∃ e, s.edit? = some e ∧ e'.version = e.version ∧ e'.ref = e.ref := by
  cases s with
  | loggedIn sess =>
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
    cases screen <;> cases op <;> simp [perform, onScreen, Screen.isBusy, Session.refreshTo] at h
    all_goals (try split at h) <;> (try simp at h)
    all_goals first
      | subst h
      | obtain ⟨_, rfl⟩ := h
      | skip
    all_goals (try simp only [searchTo_edit?] at he')
    all_goals simp_all [State.edit?, State.session?, Session.to, Screen.edit?]
    all_goals (subst he'; exact ⟨rfl, rfl⟩)
  | _ => cases op <;> simp [perform] at h <;> subst h <;> simp [State.edit?, State.session?] at he'

/-- P4 の画面の側(2): 競合したら、読み直すまで更新を送らない(ほかの人の保存を上書きしない)。 -/
theorem p4_no_update_after_conflict {sess : Session P F} {e : Edit} {op : Op P F} {st : Step P F}
    (hs : sess.screen = .conflicted e) (h : perform (.loggedIn sess) op = some st) :
    ∀ e' k a, Effect.update e' k a ∉ st.effects := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
  simp at hs; subst hs
  cases op <;> simp [perform, onScreen, Screen.isBusy] at h <;> subst h <;> simp [Session.to]

/-- P12 の画面の側: 結果が分からない更新を送り直すときは、同じ中身・同じキーで送る。
    サーバーは同じキーの更新を1回しか効かせないので、何度送り直しても1回分(`Authz.p12_replay`)。 -/
theorem p12_resend_same {sess : Session P F} {e : Edit} {key : String} {failed : Bool}
    {op : Op P F} {st : Step P F} (hs : sess.screen = .updateUnknown e key failed)
    (h : perform (.loggedIn sess) op = some st) :
    ∀ e' k a, Effect.update e' k a ∈ st.effects → e' = e ∧ k = key := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
  simp at hs; subst hs
  cases op <;> simp [perform, onScreen, Screen.isBusy, Session.refreshTo] at h <;> subst h <;>
    simp [Session.to]
  intro e' k a h₁ h₂ _; exact ⟨h₁, h₂⟩

/-- P12 の画面の側: 更新の結果が分からなくなっても、中身とキーはそのまま持っておく(再送に使う)。 -/
theorem p12_unknown_keeps {sess : Session P F} {e : Edit} {key : String} {st : Step P F}
    (hs : sess.screen = .updating e key false) (h : receive (.loggedIn sess) .unknown = some st) :
    st.state = .loggedIn { sess with screen := .updateUnknown e key false } := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
  simp at hs; subst hs
  simp [receive, onReply] at h; subst h; rfl

/-- 差し出すかどうかは状態だけで決まり、操作の中身(座標・キー・市など)には左右されない。
    だから画面は「今押せるか」を状態から決められる。 -/
theorem offer_depends_on_kind_only (s : State P F) (op₁ op₂ : Op P F)
    (hk : op₁.kind = op₂.kind) : (perform s op₁).isSome = (perform s op₂).isSome := by
  cases op₁ <;> cases op₂ <;> simp [Op.kind] at hk <;>
    cases s <;> simp [perform] <;>
    (try rename_i s; obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s; cases screen <;> simp [onScreen]) <;>
    (try split <;> simp_all) <;>
    (try split <;> simp_all)

/-! ## 範囲の検索(P13): 応答の順序が入れ替わっても、一覧を取り違えない -/

/-- P13(1) 古い応答で一覧を替えない: 検索の応答で状態が変わるなら、それは今の本人が送った、
    いちばん新しい検索への応答。追い越された検索や、前のセッションで送った検索の応答は、何も変えない。
    前の本人として送った検索に「本人が変わった」と返っても、今の本人はログアウトしない。 -/
theorem p13_only_latest {sys : Sys P F} {pre post : List (Effect P)} {q : Query P} {a : String}
    {r : SearchResult F} {st : Step P F} (h : Reachable server sys)
    (hfl : sys.inflight = pre ++ .search q a :: post)
    (hst : receive sys.app (.searched q.seq r) = some st) (hchg : st.state ≠ sys.app) :
    ∃ s, sys.app = .loggedIn s ∧ s.search.pending = some q ∧ a = s.me.id := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  simp only at hfl hchg
  subst hfl
  cases app with
  | loggedIn s =>
    simp only [Inv] at hinv
    obtain ⟨-, hs, -, ⟨hpend, -, -⟩, -⟩ := hinv
    simp only [receive, Option.some.injEq] at hst
    subst hst
    unfold onSearched at hchg
    split at hchg
    · rename_i q' hq'
      split at hchg
      · rename_i hseq
        obtain ⟨-, hmem⟩ := hpend q' hq'
        obtain ⟨rfl, rfl⟩ := search_unique hs.1 hmem
          (show Effect.search q a ∈ pre ++ Effect.search q a :: post by simp) hseq
        exact ⟨s, rfl, hq', rfl⟩
      · exact absurd rfl hchg
    · exact absurd rfl hchg
  | _ => simp [receive] at hst; subst hst; exact absurd rfl hchg

/-- P13(2) 一覧に出すのは、今の本人に返してよいものだけ。サーバーが本人 `a` への検索に `ok a` を満たす
    結果しか返さないなら、一覧はいつも `ok 今の本人` を満たす。`ok a` を「`a` が読める地物だけ」とすると
    (`Authz.canRead` と RLS)、ログインし直したあとに前の本人(たとえば管理者)への検索の応答が届いても、
    今の本人(たとえば閲覧者)の一覧には出ない。 -/
theorem p13_shown_ok {sys : Sys P F} {s : Session P F} {q : Query P} {hits : List (Ref × F)}
    (h : Reachable server sys) (hs : sys.app.session? = some s)
    (hl : s.search.shown = some (.found q hits)) : server.ok s.me.id hits := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  cases app <;> simp [State.session?] at hs <;> subst hs <;> simp only [Inv] at hinv
  · exact hinv.2.2.2.1.2.2 q hits hl
  · exact hinv.2.2.2.2.1.2 q hits hl

/-- P13(3) 検索中でなければ、一覧は今見えている範囲のもの。応答が送った順に届かなくても、
    最後に動かした範囲と違う範囲の一覧を、検索が終わったものとして出さない。 -/
theorem p13_settled {sys : Sys P F} {s : Session P F} (h : Reachable server sys)
    (hs : sys.app = .loggedIn s) (hp : s.search.pending = none) :
    s.search.shown.map (·.query.area) = s.map.area := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  simp only at hs
  subst hs
  simp only [Inv] at hinv
  exact hinv.2.2.2.1.2.1 hp

/-- P13(4) 検索中なら、その検索は今の本人として飛んでいる。応答はどれも受け取れるので
    (`replies_accepted`)、応答が届けば検索中を抜ける。 -/
theorem p13_pending_inflight {sys : Sys P F} {s : Session P F} {q : Query P}
    (h : Reachable server sys) (hs : sys.app = .loggedIn s) (hp : s.search.pending = some q) :
    Effect.search q s.me.id ∈ sys.inflight := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  simp only at hs
  subst hs
  simp only [Inv] at hinv
  exact (hinv.2.2.2.1.1 q hp).2

/-! ## 変更の知らせ(P14): 他人の保存が届いても、正直に知らせ、応答を捨てない -/

theorem searchTo_screen {s s' : Session P F} {sc : Screen P F}
    (h : (s.searchTo sc).state = .loggedIn s') : s'.screen = sc := by
  unfold Session.searchTo at h
  split at h <;> simp [Session.to] at h <;> subst h <;> rfl

theorem onSearched_screen {s s' : Session P F} {seq : Nat} {r : SearchResult F}
    (h : (onSearched s seq r).state = .loggedIn s') : s'.screen = s.screen := by
  unfold onSearched at h
  split at h <;> (try split at h) <;> (try split at h) <;> (try split at h) <;>
    simp at h <;> subst h <;> rfl

/-- 知らせでは、応答待ちを抜けない。抜けると、飛んでいる副作用の応答を受け取れなくなる(L1 の反例と同じ)。
    自分の更新が効いたという知らせが応答より先に届いても、更新中のまま、効いたことだけを覚える。 -/
theorem notice_keeps_busy (s : State P F) (n : Notice P) (h : s.isBusy = true) :
    (notify s n).state.isBusy = true := by
  cases s with
  | loggedIn sess =>
    obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
    simp only [State.isBusy] at h
    cases n with
    | tilesIdentityChanged => simp [notify, h, State.isBusy]
    | mapMoved area => simp only [notify]; simp_searchTo; exact h
    | changed c =>
      simp only [notify]
      split
      · cases screen <;> simp [Screen.isBusy] at h <;> simp only [onChanged, Session.refreshTo] <;>
          (try split) <;> (try simp_searchTo) <;> simp [Session.to, State.isBusy, Screen.isBusy]
      · simpa [State.isBusy] using h
    | resumed actor =>
      simp only [notify]
      split
      · simp only [Session.refreshTo]; simp_searchTo; exact h
      · simpa [State.isBusy] using h
    | permissionChanged me' =>
      simp only [notify]
      split
      · cases screen <;> simp [Screen.isBusy] at h <;>
          simp only [Session.withPermission, Session.refreshTo] <;> simp_searchTo <;> simp [Screen.isBusy]
      · simpa [State.isBusy] using h
  | _ => simp [State.isBusy] at h

/-- P14 前の本人の流れから届いた変更の知らせは、何も変えない(ログインし直す前に開いた流れから、
    あとで届くことがある)。 -/
theorem p14_other_stream_ignored {s : Session P F} {c : Change} (h : c.actor ≠ s.me.id) :
    notify (.loggedIn s) (.changed c) = ⟨.loggedIn s, []⟩ := by
  simp [notify, h]

/-- P14 「ほかの人が更新した」と出すのは、今の本人の流れから、編集している地物が読み込んだときより
    新しい版になったと知らされたときだけ。自分の更新が戻ってきた知らせは、読み込んだ版と同じなので出さない。
    サーバーが、実際に効いた版しか知らせないなら(db/migrations/005)、この表示は正直。 -/
theorem p14_stale_only_newer {s s' : Session P F} {e e' : Edit} {f f' : Bool} {n : Notice P}
    (hs : s.screen = .editing e f false) (h : (notify (.loggedIn s) n).state = .loggedIn s')
    (hs' : s'.screen = .editing e' f' true) :
    ∃ c, n = .changed c ∧ c.actor = s.me.id ∧ c.id = e.ref.id ∧ e.version < c.version := by
  cases n with
  | tilesIdentityChanged => simp [notify, hs, Screen.isBusy] at h
  | mapMoved area =>
    simp only [notify] at h
    rw [searchTo_screen h, hs] at hs'
    simp at hs'
  | changed c =>
    simp only [notify] at h
    split at h
    · rename_i hactor
      simp only [onChanged, hs, Session.refreshTo] at h
      split at h
      · rename_i hc
        exact ⟨c, rfl, hactor, hc.1, hc.2⟩
      · simp [searchTo_screen h, hs] at hs'
    · simp at h; subst h; rw [hs] at hs'; simp at hs'
  | resumed actor =>
    simp only [notify] at h
    split at h
    · simp only [Session.refreshTo] at h
      rw [searchTo_screen h, hs] at hs'
      simp at hs'
    · simp at h; subst h; rw [hs] at hs'; simp at hs'
  | permissionChanged me' =>
    simp only [notify] at h
    split at h
    · simp only [Session.withPermission, Session.refreshTo, hs] at h
      simp [searchTo_screen h] at hs'
    · simp at h; subst h; rw [hs] at hs'; simp at hs'

/-- P14 結果が分からない更新を、知らせで成功(閲覧)にするのは、そのキーが効いたときだけ。
    サーバーは効いたキーしか知らせないので(`NoticeOk`)、送り直さずに済むのは本当に効いたときだけ。 -/
theorem p14_unknown_resolved_applied {s s' : Session P F} {e : Edit} {k : String} {f : Bool}
    {n : Notice P} {sel : Option (Selected P F)} (hn : NoticeOk server n)
    (hs : s.screen = .updateUnknown e k f) (h : (notify (.loggedIn s) n).state = .loggedIn s')
    (hs' : s'.screen = .view sel) : server.applied k := by
  cases n with
  | tilesIdentityChanged => simp [notify, hs, Screen.isBusy] at h
  | mapMoved area =>
    simp only [notify] at h
    rw [searchTo_screen h, hs] at hs'
    simp at hs'
  | changed c =>
    simp only [notify] at h
    split at h
    · simp only [onChanged, hs, Session.refreshTo] at h
      split at h
      · rename_i hkey
        simpa [NoticeOk, hkey] using hn
      · simp [searchTo_screen h, hs] at hs'
    · simp at h; subst h; rw [hs] at hs'; simp at hs'
  | resumed actor =>
    simp only [notify] at h
    split at h
    · simp only [Session.refreshTo] at h
      rw [searchTo_screen h, hs] at hs'
      simp at hs'
    · simp at h; subst h; rw [hs] at hs'; simp at hs'
  | permissionChanged me' =>
    simp only [notify] at h
    split at h
    · simp only [Session.withPermission, Session.refreshTo, hs] at h
      simp [searchTo_screen h] at hs'
    · simp at h; subst h; rw [hs] at hs'; simp at hs'

/-- P14 更新中(送り直しを含む)に、応答を受け取って成功(閲覧)にするのは、そのキーが効いたときだけ。成功の応答か、
    効いたという知らせを先に受けたうえでの結果不明の応答のどちらか。 -/
theorem p14_update_success_applied {sys : Sys P F} {s s' : Session P F} {e : Edit} {k : String}
    {a : Bool} {pre post : List (Effect P)} {eff : Effect P} {r : Reply F} {st : Step P F}
    {sel : Option (Selected P F)}
    (h : Reachable server sys) (happ : sys.app = .loggedIn s)
    (hs : s.screen = .updating e k a ∨ s.screen = .reupdating e k a)
    (hfl : sys.inflight = pre ++ eff :: post) (hans : Answers server eff r)
    (hr : receive (.loggedIn s) r = some st) (hst : st.state = .loggedIn s')
    (hs' : s'.screen = .view sel) : server.applied k := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  simp only at happ hfl
  subst happ hfl
  simp only [Inv] at hinv
  obtain ⟨hl, -, -, -, hupd, -⟩ := hinv
  have hkey : a = true → server.applied k := fun ha =>
    hupd k (by rcases hs with hs | hs <;> simp [hs, ha])
  by_cases hseq : eff.seq? = none
  · have hin : s.inflight = [Effect.update e k s.me.id] := by
      rcases hs with hs | hs <;> simp [Session.inflight, hs]
    rw [hin] at hl
    obtain ⟨rfl, -⟩ := lane_single hseq hl
    cases hans with
    | updated happlied => exact happlied
    | updateUnknown =>
      cases a
      · rcases hs with hs | hs <;> simp [receive, onReply, hs, Session.to] at hr <;> subst hr <;>
          simp at hst <;> subst hst <;> simp at hs'
      · exact hkey rfl
    | _ =>
      rcases hs with hs | hs <;> simp [receive, onReply, hs, Session.to, Screen.isBusy] at hr <;>
        subst hr <;> simp at hst <;> (try (subst hst; simp at hs'))
  · rcases hs with hs | hs <;> cases hans <;> simp [Effect.seq?] at hseq <;> simp [receive] at hr <;>
      subst hr <;> (rw [onSearched_screen hst, hs] at hs'; simp at hs')

/-! ## 権限の追従(P15): ログインしている間に権限が変わっても、知らされた最新の権限に従う -/

/-- P15 確定で保存を送るのは、送るときの本人がその下書きを描けるときだけ(編集権限があり、管理者か、担当の市)。
    結果が分からない下書きの再送は、もう送った要求を送り直すだけなので含めない(サーバーが今の権限で判断する。P3)。
    事例研究3までは「下書きがあるのは編集できる人だけ」(`DraftOk`)を不変条件にしていたが、ログインの途中で
    権限が変わると下書きは残るので成り立たなくなった。送るときの権限についての定理に言い直した。 -/
theorem p15_commit_permitted {s : Session P F} {op : Op P F} {st : Step P F} {d : Draft P}
    {a : String} (h : perform (.loggedIn s) op = some st) (hs : Effect.save d a ∈ st.effects)
    (hop : op.kind ≠ .resend) : canDraw s.me d = true := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
  cases op <;> simp [Op.kind] at hop <;> cases screen <;>
    simp [perform, onScreen, Screen.isBusy, Session.refreshTo] at h
  all_goals (try split at h) <;> (try simp at h)
  all_goals first
    | (obtain ⟨hc, rfl⟩ := h
       simp [Session.to] at hs
       all_goals (obtain ⟨rfl, -⟩ := hs; exact hc.2))
    | (subst h; simp_searchTo; simp [Session.to] at hs)
    | (subst h; simp [Session.to] at hs)

/-- P15 編集の保存で更新を送るのは、送るときの本人がその地物を編集できるときだけ。結果が分からない更新の再送は
    含めない(同じキーの送り直しで、サーバーが判断する)。 -/
theorem p15_save_edit_permitted {s : Session P F} {op : Op P F} {st : Step P F} {e : Edit}
    {k a : String} (h : perform (.loggedIn s) op = some st) (hs : Effect.update e k a ∈ st.effects)
    (hop : op.kind ≠ .resend) : canEditFeature s.me e.ref = true := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := s
  cases op <;> simp [Op.kind] at hop <;> cases screen <;>
    simp [perform, onScreen, Screen.isBusy, Session.refreshTo] at h
  all_goals (try split at h) <;> (try simp at h)
  all_goals first
    | (obtain ⟨hc, rfl⟩ := h
       simp [Session.to] at hs
       all_goals (first | (obtain ⟨rfl, -⟩ := hs; exact hc.1) | exact absurd hs (by simp)))
    | (subst h; simp_searchTo; simp [Session.to] at hs)
    | (subst h; simp [Session.to] at hs)

/-- P15 ポップアップの地物は、今の本人が読めるもの。地図で選ぶときに今の権限で確かめ、権限が変わったら外す
    (権限が変わった直後は、古い権限のタイルがまだ描かれていることがある)。 -/
theorem p15_selected_readable {sys : Sys P F} {s : Session P F} {sel : Selected P F}
    (h : Reachable server sys) (hs : sys.app = .loggedIn s) (hsel : s.screen = .view (some sel)) :
    canReadFeature s.me sel.ref = true := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  simp only at hs
  subst hs
  simp only [Inv] at hinv
  exact hinv.2.2.1 sel hsel

/-- P15 一覧は、今の権限になってから送った検索の結果だけ。権限が変わったと知らされたら一覧を消し、番号の始まり
    (`since`)を置き直すので、知らされる前に送った検索の応答は、届いても出さない。知らされたあとに送った検索は、
    サーバーが新しい権限で答える(RLS は要求ごとに DB の権限を読む。tests/properties で確かめる)。 -/
theorem p15_listing_since {sys : Sys P F} {s : Session P F} {l : Listing P F}
    (h : Reachable server sys) (hs : sys.app = .loggedIn s) (hl : s.search.shown = some l) :
    s.search.since ≤ l.query.seq := by
  have hinv := reachable_inv h
  obtain ⟨app, fl⟩ := sys
  simp only at hs
  subst hs
  simp only [Inv] at hinv
  exact hinv.2.2.2.2.2.2.2 l hl

/-- P15 今の本人の権限が変わったと知らされたら、本人を差し替え、選んでいた地物と一覧を消す。 -/
theorem p15_change_applied {s : Session P F} {me : Me} (hid : me.id = s.me.id) (hne : me ≠ s.me) :
    ∃ s', (notify (.loggedIn s) (.permissionChanged me)).state = .loggedIn s' ∧ s'.me = me ∧
      s'.search.shown = none ∧ ∀ sel, s'.screen ≠ .view (some sel) := by
  obtain ⟨me₀, tiles, screen, ⟨area, issued⟩, search, mapLag⟩ := s
  simp only at hid hne
  cases area <;> cases screen <;>
    simp [notify, hid, hne, Session.withPermission, Session.refreshTo, Session.searchTo, Session.to]

/-- P15 今の権限と同じ権限の知らせ(変更の流れをつなぐたびにサーバーが送る)では、何も変えない
    (つなぎ直すたびに、選んでいる地物や一覧を消さない)。 -/
theorem p15_same_permission_ignored {s : Session P F} :
    notify (.loggedIn s) (.permissionChanged s.me) = ⟨.loggedIn s, []⟩ := by
  simp [notify]

/-- P15 結果が分からない更新の送り直しが拒否されても、結果不明のまま(中身とキーを持っておく)。
    権限を外されたあとは、前に効いたキーの送り直しもサーバーが拒否する(RLS がキーを見るより先に効く。
    tests/properties/p15-permission-change.test.ts で測った)ので、送り直しの拒否は「効かなかった」ことを
    意味しない。更新失敗として編集に戻すのは、初めて送った更新が拒否されたときだけ。 -/
theorem p15_resend_rejected_unknown {sess : Session P F} {e : Edit} {key : String} {a : Bool}
    {st : Step P F} (hs : sess.screen = .reupdating e key a)
    (h : receive (.loggedIn sess) .rejected = some st) :
    st.state = .loggedIn { sess with screen := .updateUnknown e key true } := by
  obtain ⟨me, tiles, screen, map, search, mapLag⟩ := sess
  simp at hs; subst hs
  simp [receive, onReply] at h; subst h; rfl

/-- P15 別の人の権限の知らせは捨てる(本人の流れにしか流れないが、念のため)。 -/
theorem p15_other_user_ignored {s : Session P F} {me : Me} (h : me.id ≠ s.me.id) :
    notify (.loggedIn s) (.permissionChanged me) = ⟨.loggedIn s, []⟩ := by
  simp [notify, h]

/-- 地図から読み込みに入るとき、クリックされた地物の版を読み込み待ちの状態に保存する。 -/
theorem p16_start_keeps_tile_version {s s' : Session P F} {sel : Selected P F}
    {st : Step P F} (hsel : s.screen = .view (some sel))
    (h : perform (.loggedIn s) .startEdit = some st)
    (hs : st.state = .loggedIn s') :
    s'.screen = .loading sel.ref ∧ sel.ref.version.isSome = true := by
  simp [perform, onScreen, hsel] at h
  obtain ⟨hallowed, rfl⟩ := h
  simp [Session.to] at hs
  subst s'
  exact ⟨rfl, by cases hv : sel.ref.version <;> simp_all [Session.offersTileEdit]⟩

/-- 版のあるクリックから読み込んだ地物を編集できるのは、ID と版が一致したときだけ。 -/
theorem p16_edit_matches_tile {s s' : Session P F} {ref : Ref} {e actual : Edit}
    {v : Nat} {st : Step P F} (hload : s.screen = .loading ref) (hv : ref.version = some v)
    (h : receive (.loggedIn s) (.loaded e) = some st) (hs : st.state = .loggedIn s')
    (hedit : s'.screen = .editing actual false false) :
    actual.ref.id = ref.id ∧ actual.version = v := by
  simp [receive, onReply, hload] at h
  split at h <;> simp only [Option.some.injEq] at h <;> subst st
  · rename_i hmatch
    simp [Session.to] at hs
    subst s'
    simp at hedit
    subst actual
    have hm := hmatch
    simp [Ref.matchesLoad, hv] at hm
    exact ⟨hm.1.symm, hm.2.symm⟩
  · let lagged := { s with screen := .loading ref, tiles := s.tiles + 1, mapLag := some (ref.id, e.version) }
    change (lagged.searchTo (.view none)).state = .loggedIn s' at hs
    have ⟨next, hstate, hscreen, _⟩ := searchTo_state lagged (.view none)
    rw [hstate] at hs
    simp at hs
    subst s'
    rw [hscreen] at hedit
    contradiction

/-- A shared boundary draft leaves the editing screen only after the other rendered version was verified. -/
theorem p17_save_boundary_verified {s : Session P F} {b : BoundaryEdit} {e : Edit}
    {failed stale : Bool} {key : String} {st : Step P F}
    (hview : s.screen = .editing e failed stale)
    (h : perform (.loggedIn s) (.saveEdit key) = some st)
    (hb : e.boundary = some b) (hd : b.draft.isSome) :
    b.verified := by
  by_cases hp : e.boundaryPermitsSave
  · exact hp b hb hd
  · simp [perform, onScreen, hview, hp] at h

end App
