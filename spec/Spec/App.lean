import Spec.Domain
import Spec.Authz
import Spec.Boundary

/-
画面の状態機械の仕様。TypeScript の実装(src/lib/app/machine.ts)はこれを写したもので、
両者が同じ答えを返すことは tests/conformance で突き合わせる。

地図の座標 `P` と地物の属性 `F` は型の引数にしてある。状態機械はどちらの中身も見ないので、
ここで証明した性質は、座標や属性がどんな値でも成り立つ。
-/
namespace App

open Domain

structure Draft (P : Type) where
  key : String
  city : City
  isPublic : Bool
  points : List P

/-- 地図で選んだ地物。編集できるかを決めるのに、市と公開を使う(`Authz.canWrite`)。 -/
structure Ref where
  id : Nat
  city : City
  isPublic : Bool
  version : Option Nat := none
  deriving DecidableEq, Repr

def Ref.feature (r : Ref) : Authz.Feature := ⟨r.city, r.isPublic⟩

structure Selected (P F : Type) where
  pos : P
  ref : Ref
  props : F

/-- 地図に見えている範囲(南西の角と北東の角)。状態機械は中身を見ない。 -/
abbrev Area (P : Type) := P × P

/-- 範囲の検索の要求。番号(`seq`)はタブの中で一度きりで、ログインし直しても振り直さない。
    検索は同時にいくつも飛び、応答は送った順に届くとは限らないので、応答には番号を書く。 -/
structure Query (P : Type) where
  seq : Nat
  area : Area P

/-- タブの地図。ログインとは関係なく続く(ログアウトしたあとも、前の本人の検索の応答は届く)。 -/
structure MapView (P : Type) where
  /-- 今見えている範囲。地図が最初に範囲を知らせるまでは分からない -/
  area : Option (Area P)
  /-- これまでに振った検索の番号の数(次に振る番号) -/
  issued : Nat

def MapView.movedTo (m : MapView P) (area : Area P) : MapView P := { m with area := some area }

/-- 一覧に出しているもの。どの検索への応答かを持つ。 -/
inductive Listing (P F : Type) where
  | found (q : Query P) (hits : List (Ref × F))
  | failed (q : Query P)

def Listing.query : Listing P F → Query P
  | .found q _ | .failed q => q

/-- 範囲の一覧。応答を待つのは、いちばん新しい検索だけ(それより前の検索の応答は、届いても捨てる)。
    `since` は、今の権限で振った最初の番号(P15)。権限が変わったら、一覧を消してここから振り直す。 -/
structure Search (P F : Type) where
  pending : Option (Query P)
  shown : Option (Listing P F)
  since : Nat

/-- 編集中の値。版(`version`)は、サーバーから読み込んだときのもの。 -/
structure Edit where
  ref : Ref
  version : Nat
  name : String
  note : String
  boundary : Option BoundaryEdit := none
  deriving DecidableEq, Repr

def Edit.resetBoundary (e : Edit) : Edit :=
  { e with boundary := e.boundary.map fun b => { b with draft := none, verifiedVersion := none } }

def Edit.boundaryPermitsSave (e : Edit) : Prop :=
  ∀ b, e.boundary = some b → b.draft.isSome → b.verified

instance (e : Edit) : Decidable e.boundaryPermitsSave := by
  unfold Edit.boundaryPermitsSave
  cases e.boundary with
  | none => exact isTrue (by simp)
  | some b =>
    by_cases h : b.draft.isSome → b.verified
    · exact isTrue (by simpa using h)
    · exact isFalse (by simpa using h)

inductive Screen (P F : Type) where
  | view (selected : Option (Selected P F))
  | drawing (draft : Draft P) (failed : Bool)
  | saving (draft : Draft P)
  | unknown (draft : Draft P) (failed : Bool)
  | resaving (draft : Draft P)
  /-- 編集するために、地物の今の版を読み込んでいる -/
  | loading (ref : Ref)
  /-- 名前と備考を編集している。`stale` は、ほかの人がこの地物を、読み込んだときより新しい版にしたと
      知らされたこと(P14)。保存すれば競合になるので、読み直せるようにする -/
  | editing (edit : Edit) (failed : Bool) (stale : Bool)
  /-- 更新を送った。キーは、この中身の更新を表す(P12)。`applied` は、このキーが効いたという
      変更の知らせが、応答より先に届いたこと(P14) -/
  | updating (edit : Edit) (key : String) (applied : Bool)
  | updateUnknown (edit : Edit) (key : String) (failed : Bool)
  /-- 結果が分からない更新を、同じキーで送り直した(P12)。拒否されても、前に送ったときに効いたかもしれない
      ので、結果不明に戻る(P15: 権限を外されたあとは、効いたキーの送り直しもサーバーが拒否する) -/
  | reupdating (edit : Edit) (key : String) (applied : Bool)
  /-- ほかの人が先に保存していた(P4)。読み直すまで更新を送らない -/
  | conflicted (edit : Edit)

structure Session (P F : Type) where
  me : Me
  tiles : Nat
  screen : Screen P F
  map : MapView P
  search : Search P F
  /-- 編集を待つ地物の ID と、確認済みの DB の版。 -/
  mapLag : Option (Nat × Nat) := none

/-- 地図(`MapView`)は、どの状態にもある。ログインし直しても、検索の番号は続きから振る。 -/
inductive State (P F : Type) where
  | loggedOut (error : Option String) (map : MapView P)
  | loggingIn (email : String) (map : MapView P)
  | loggedIn (s : Session P F)
  | loggingOut (s : Session P F)

/-- 利用者の操作。その状態で差し出されていなければ、送る手段がない。 -/
inductive Op (P F : Type) where
  | pressLogin (email : String)
  | pressLogout
  | clickMap (pos : P) (feature : Option (Ref × F))
  | closePopup
  | startDrawing (key : String)
  | chooseCity (city : City)
  | choosePublic (isPublic : Bool)
  | commit
  | cancel
  | resend
  | startEdit
  | editName (name : String)
  | editNote (note : String)
  | moveBoundary (position : Nat)
  | saveEdit (key : String)
  | reload

inductive OpKind where
  | pressLogin | pressLogout | clickMap | closePopup | startDrawing
  | chooseCity | choosePublic | commit | cancel | resend
  | startEdit | editName | editNote | moveBoundary | saveEdit | reload
  deriving DecidableEq, Repr

def Op.kind {P F : Type} : Op P F → OpKind
  | .pressLogin _ => .pressLogin
  | .pressLogout => .pressLogout
  | .clickMap _ _ => .clickMap
  | .closePopup => .closePopup
  | .startDrawing _ => .startDrawing
  | .chooseCity _ => .chooseCity
  | .choosePublic _ => .choosePublic
  | .commit => .commit
  | .cancel => .cancel
  | .resend => .resend
  | .startEdit => .startEdit
  | .editName _ => .editName
  | .editNote _ => .editNote
  | .moveBoundary _ => .moveBoundary
  | .saveEdit _ => .saveEdit
  | .reload => .reload

/-- 範囲の検索の結果。 -/
inductive SearchResult (F : Type) where
  | found (hits : List (Ref × F))
  | failed
  /-- 要求に書いた本人と、サーバーのセッションの本人が違った(P11) -/
  | identityChanged

/-- 副作用の結果。届いた状態で必ず受け取らなければならない。 -/
inductive Reply (F : Type) where
  | loginOk (me : Me)
  | loginFailed (message : String)
  | logoutOk
  | logoutFailed
  | saved
  | rejected
  | unknown
  /-- 保存の要求に書いた本人と、サーバーのセッションの本人が違った(P11)。 -/
  | identityChanged
  /-- 地物の今の版を読み込めた -/
  | loaded (edit : Edit)
  | loadFailed
  /-- 更新の版が古かった。ほかの人が先に保存していた(P4) -/
  | conflict
  /-- 番号 `seq` の検索の結果。検索だけは同時にいくつも飛ぶので、どの要求への応答かを書く -/
  | searched (seq : Nat) (result : SearchResult F)

/-- サーバーで地物が変わったという知らせ(変更の流れから届く)。キーは効いた要求のもの
    (作成は `request_key`、更新は `feature_update` のキー)。 -/
structure Change where
  id : Nat
  version : Nat
  key : String
  /-- 変更の流れを開いた本人(要求の `as`)。ログインし直す前の流れから届いたものは捨てる -/
  actor : String

/-- 副作用とは関係なく届く知らせ。どの状態でも受け取る。
    地図ライブラリは状態機械の外でタイルを取りに行くので、その失敗はここに届く。 -/
inductive Notice (P : Type) where
  /-- タイルの要求に書いた本人と、サーバーのセッションの本人が違った(P11)。 -/
  | tilesIdentityChanged
  /-- 地図が動いた(利用者は、状態に関係なく地図を動かせる) -/
  | mapMoved (area : Area P)
  /-- サーバーで地物が変わった(P14) -/
  | changed (c : Change)
  /-- 変更の流れが切れて、つなぎ直した。切れている間の変更は、取りこぼしたかもしれない -/
  | resumed (actor : String)
  /-- 本人の権限(ロール・編集権限)が変わった(P15)。変更の流れから届く。中身は、サーバーが DB から
      読んだ新しい本人 -/
  | permissionChanged (me : Me)

inductive Effect (P : Type) where
  | login (email : String)
  | logout
  /-- 保存は、画面が本人として表示している利用者(`actor`)として送る(P11)。 -/
  | save (draft : Draft P) (actor : String)
  | load (id : Nat) (actor : String)
  | update (edit : Edit) (key : String) (actor : String)
  /-- 範囲の検索。ほかの副作用と違い、応答を待たずに次の検索を送る -/
  | search (q : Query P) (actor : String)

structure Step (P F : Type) where
  state : State P F
  effects : List (Effect P)

variable {P F : Type}

/-- 副作用の応答を待っている。この間は、ほかの副作用を出さない(飛んでいる副作用は高々1つ)。 -/
def Screen.isBusy : Screen P F → Bool
  | .saving _ | .resaving _ | .loading _ | .updating _ _ _ | .reupdating _ _ _ => true
  | _ => false

/-- 本人が、選んだ地物を編集できるか。サーバーの RLS と同じ判断(`Authz.canWrite`)を使う。 -/
def canEditFeature (me : Me) (ref : Ref) : Bool :=
  Authz.canWrite ⟨me.role, me.canEdit⟩ ref.feature

/-- 本人が、その地物を読めるか。サーバーの RLS と同じ判断(`Authz.canRead`)を使う(P15)。 -/
def canReadFeature (me : Me) (ref : Ref) : Bool :=
  Authz.canRead ⟨me.role, me.canEdit⟩ ref.feature

/-- 本人が、その下書きを保存できるか。サーバーの作成の判断(`Authz.canCreate`、RLS の with check)と同じ
    判断を使う(P15)。 -/
def canDraw (me : Me) (d : Draft P) : Bool :=
  Authz.canCreate ⟨me.role, me.canEdit⟩ ⟨d.city, d.isPublic⟩

/-- ログインした直後のセッション。一覧は空で、地図はそれまでのもの。 -/
def Session.fresh (me : Me) (map : MapView P) : Session P F :=
  { me, tiles := 0, screen := .view none, map, search := ⟨none, none, map.issued⟩ }

/-- ページを読み込んだときの状態。ページを読み込み直すと飛んでいた要求もなくなるので、番号は 0 から振る。 -/
def init (me : Option Me) : State P F :=
  match me with
  | some me => .loggedIn (Session.fresh me ⟨none, 0⟩)
  | none => .loggedOut none ⟨none, 0⟩

def Session.to (s : Session P F) (screen : Screen P F) (effects : List (Effect P) := []) :
    Step P F :=
  ⟨.loggedIn { s with screen }, effects⟩

/-- 今見えている範囲を検索して、画面 `screen` に移る。番号を1つ振り、応答を待つ検索をこれに替える。
    範囲がまだ分からなければ検索しない。 -/
def Session.searchTo (s : Session P F) (screen : Screen P F) : Step P F :=
  match s.map.area with
  | none => s.to screen
  | some area =>
    let q : Query P := ⟨s.map.issued, area⟩
    { s with map := { s.map with issued := s.map.issued + 1 },
             search := { s.search with pending := some q } }.to screen [.search q s.me.id]

/-- 保存が終わった(または取り消した)ので、タイルと一覧を読み直す。 -/
def Session.refreshTo (s : Session P F) (screen : Screen P F) : Step P F :=
  { s with tiles := s.tiles + 1 }.searchTo screen

def Session.offersTileEdit (s : Session P F) (ref : Ref) : Bool :=
  canEditFeature s.me ref && match ref.version, s.mapLag with
  | none, _ => false
  | some v, some (id, latest) => id != ref.id || v >= latest
  | some _, none => true

def Ref.matchesLoad (r : Ref) (e : Edit) : Prop :=
  r.id = e.ref.id ∧ (r.version = none ∨ r.version = some e.version)

instance (r : Ref) (e : Edit) : Decidable (r.matchesLoad e) := by
  unfold Ref.matchesLoad
  infer_instance

def onScreen (s : Session P F) : Op P F → Option (Step P F)
  | .clickMap pos feature =>
    match s.screen with
    | .view _ =>
      -- 今の権限で読めない地物は選ばない(権限が変わった直後は、古いタイルがまだ描かれていることがある。P15)
      some (s.to (.view ((feature.filter fun (ref, _) => canReadFeature s.me ref).map
        fun (ref, props) => ⟨pos, ref, props⟩)))
    | .drawing d failed => some (s.to (.drawing { d with points := d.points ++ [pos] } failed))
    | .editing e failed stale =>
      match e.boundary with
      | some b =>
        let verified := match feature with
          | some (r, _) => b.verify r.id r.version
          | none => b
        some (s.to (.editing { e with boundary := some verified } failed stale))
      | none => none
    | _ => none
  | .closePopup =>
    match s.screen with
    | .view (some _) => some (s.to (.view none))
    | _ => none
  | .startDrawing key =>
    match s.screen with
    | .view _ =>
      if s.me.canEdit then some (s.to (.drawing ⟨key, s.me.home, false, []⟩ false)) else none
    | _ => none
  | .chooseCity city =>
    match s.screen with
    | .drawing d failed =>
      if s.me.role = .admin then some (s.to (.drawing { d with city } failed)) else none
    | _ => none
  | .choosePublic isPublic =>
    match s.screen with
    | .drawing d failed => some (s.to (.drawing { d with isPublic } failed))
    | _ => none
  | .commit =>
    match s.screen with
    | .drawing d _ =>
      if 3 ≤ d.points.length ∧ canDraw s.me d then some (s.to (.saving d) [.save d s.me.id]) else none
    | _ => none
  | .cancel =>
    match s.screen with
    | .drawing _ _ | .editing _ _ _ | .conflicted _ => some (s.to (.view none))
    | .unknown _ _ | .updateUnknown _ _ _ => some (s.refreshTo (.view none))
    | _ => none
  | .resend =>
    match s.screen with
    | .unknown d _ => some (s.to (.resaving d) [.save d s.me.id])
    | .updateUnknown e key _ => some (s.to (.reupdating e key false) [.update e key s.me.id])
    | _ => none
  | .startEdit =>
    match s.screen with
    | .view (some sel) =>
      if s.offersTileEdit sel.ref then some (s.to (.loading sel.ref) [.load sel.ref.id s.me.id])
      else none
    | _ => none
  | .editName name =>
    match s.screen with
    | .editing e failed stale => some (s.to (.editing { e with name } failed stale))
    | _ => none
  | .editNote note =>
    match s.screen with
    | .editing e failed stale => some (s.to (.editing { e with note } failed stale))
    | _ => none
  | .moveBoundary position =>
    match s.screen with
    | .editing e failed stale =>
      match e.boundary with
      | some b =>
        if b.verified ∧ canEditFeature s.me e.ref then
          some (s.to (.editing { e with boundary := some (b.move position) } failed stale))
        else none
      | none => none
    | _ => none
  | .saveEdit key =>
    match s.screen with
    | .editing e _ _ =>
      if canEditFeature s.me e.ref ∧ e.boundaryPermitsSave then
        some (s.to (.updating e key false) [.update e key s.me.id])
      else none
    | _ => none
  | .reload =>
    match s.screen with
    | .conflicted e | .editing e _ true =>
      some (s.to (.loading { e.ref with version := none }) [.load e.ref.id s.me.id])
    | _ => none
  | .pressLogin _ | .pressLogout => none

/-- 操作を差し出しているなら、その遷移。差し出していなければ `none`。 -/
def perform : State P F → Op P F → Option (Step P F)
  | .loggedOut _ map, .pressLogin email => some ⟨.loggingIn email map, [.login email]⟩
  | .loggedOut _ _, _ => none
  | .loggingIn _ _, _ => none
  | .loggingOut _, _ => none
  | .loggedIn s, .pressLogout =>
    if s.screen.isBusy then none else some ⟨.loggingOut s, [.logout]⟩
  | .loggedIn s, op => onScreen s op

def identityChangedMessage : String :=
  "ほかの画面で別の利用者としてログインしたため、この画面での操作を止めました。もう一度ログインしてください"

def onReply (s : Session P F) : Reply F → Option (Step P F)
  | .saved =>
    match s.screen with
    | .saving _ | .resaving _ => some (s.refreshTo (.view none))
    | .updating e _ _ | .reupdating e _ _ =>
      some ({ s with mapLag := some (e.ref.id, e.version + 1) }.refreshTo (.view none))
    | _ => none
  | .unknown =>
    match s.screen with
    | .saving d | .resaving d => some (s.to (.unknown d false))
    | .updating e key applied | .reupdating e key applied =>
      -- 効いたという知らせが先に届いていれば、応答が分からなくても成功(P14)
      some (if applied then { s with mapLag := some (e.ref.id, e.version + 1) }.refreshTo (.view none)
        else s.to (.updateUnknown e key false))
    | _ => none
  | .rejected =>
    match s.screen with
    | .saving d => some (s.to (.drawing d true))
    | .resaving d => some (s.to (.unknown d true))
    | .updating e _ _ => some (s.to (.editing e true false))
    -- 送り直しが拒否されても、前に送ったときに効いたかもしれない(P15)
    | .reupdating e key _ => some (s.to (.updateUnknown e key true))
    | _ => none
  | .identityChanged =>
    if s.screen.isBusy then some ⟨.loggedOut (some identityChangedMessage) s.map, []⟩ else none
  | .loaded e =>
    match s.screen with
    | .loading ref =>
      if ref.matchesLoad e then
        some ({ s with mapLag := s.mapLag.filter (·.1 != ref.id) }.to (.editing e.resetBoundary false false))
      else
        some ({ s with mapLag := some (ref.id, e.version) }.refreshTo (.view none))
    | _ => none
  | .loadFailed =>
    match s.screen with
    | .loading _ => some (s.to (.view none))
    | _ => none
  | .conflict =>
    match s.screen with
    | .updating e _ _ | .reupdating e _ _ => some (s.to (.conflicted e))
    | _ => none
  | _ => none

/-- 検索の応答。応答を待っているいちばん新しい検索への応答だけを一覧に出し、ほかは何も変えずに捨てる。
    本人が変わったという応答も、いちばん新しい検索へのものだけを信じる(前の本人として送った検索なら、
    今の本人は変わっていない)。ほかの副作用の応答を待っている間は、その応答を捨てないようにログアウトしない。 -/
def onSearched (s : Session P F) (seq : Nat) (r : SearchResult F) : Step P F :=
  match s.search.pending with
  | some q =>
    if q.seq = seq then
      match r with
      | .found hits =>
        ⟨.loggedIn { s with search := { s.search with pending := none, shown := some (.found q hits) } }, []⟩
      | .failed =>
        ⟨.loggedIn { s with search := { s.search with pending := none, shown := some (.failed q) } }, []⟩
      | .identityChanged =>
        if s.screen.isBusy then
          ⟨.loggedIn { s with search := { s.search with pending := none, shown := some (.failed q) } }, []⟩
        else ⟨.loggedOut (some identityChangedMessage) s.map, []⟩
    else ⟨.loggedIn s, []⟩
  | none => ⟨.loggedIn s, []⟩

/-- 応答を受け取った遷移。受け取れなければ `none`(実装では例外にする)。
    検索の応答は、どの状態でも受け取る(前のセッションで送った検索の応答も届く)。
    ログアウト中は一覧を止めておき、ログアウトに失敗したら検索し直す。 -/
def receive : State P F → Reply F → Option (Step P F)
  | .loggingIn _ map, .loginOk me => some ((Session.fresh me map).searchTo (.view none))
  | .loggingIn _ map, .loginFailed message => some ⟨.loggedOut (some message) map, []⟩
  | .loggingOut s, .logoutOk => some ⟨.loggedOut none s.map, []⟩
  | .loggingOut s, .logoutFailed => some (s.searchTo s.screen)
  | .loggedIn s, .searched seq r => some (onSearched s seq r)
  | s, .searched _ _ => some ⟨s, []⟩
  | .loggedIn s, r => onReply s r
  | _, _ => none

/-- 地物が変わったという知らせ(P14)。地図と一覧は読み直す。応答待ちの状態は抜けない(応答を捨てない)。
    - 更新中: 自分のキーなら、効いたと覚えておく(応答が結果不明でも成功にできる)
    - 更新結果不明: 自分のキーなら、効いていたので成功
    - 編集中: 編集している地物が、読み込んだときより新しい版になったら知らせる。自分の更新が
      戻ってきた知らせは、読み込んだ版と同じなので知らせない -/
def onChanged (s : Session P F) (c : Change) : Step P F :=
  match s.screen with
  | .updating e key _ =>
    if c.key = key then s.to (.updating e key true) else s.refreshTo s.screen
  | .reupdating e key _ =>
    if c.key = key then s.to (.reupdating e key true) else s.refreshTo s.screen
  | .updateUnknown _ key _ =>
    if c.key = key then s.refreshTo (.view none) else s.refreshTo s.screen
  | .editing e failed _ =>
    if c.id = e.ref.id ∧ e.version < c.version then s.refreshTo (.editing e failed true)
    else s.refreshTo s.screen
  | screen => s.refreshTo screen

/-- 権限が変わったと知らされたセッション(P15)。本人を差し替え、選んでいた地物(古い権限のタイルの属性を
    持っている)を外し、一覧を消して、今の権限での番号の始まり(`since`)を置き直す。下書きと編集は残す
    (送れるかは、送るときの権限で決める)。応答待ちの画面はそのまま。 -/
def Session.withPermission (s : Session P F) (me : Me) : Session P F :=
  { s with me,
           screen := match s.screen with
             | .view _ => .view none
             | screen => screen,
           search := ⟨none, none, s.map.issued⟩ }

/-- 知らせの受け取り。どの状態でも受け取る(`Option` ではない)。
    タイルの本人違い: 副作用の応答を待っている間は、その応答を捨てないように何もしない。
    要求にはどれも本人を書いてあるので、本人が変わっていればその応答で分かる。
    地図が動いた: ログインしていれば、その範囲を検索する。ログアウト中は範囲だけ覚えておく。
    地物が変わった・つなぎ直した: ログインしていて、今の本人の流れからなら受け取る(`onChanged`)。
    権限が変わった: 今の本人の知らせで、権限が今のものと違えば、差し替えて地図と一覧を読み直す
    (`withPermission`)。ログアウト中は、差し替えて一覧を消すだけにし、ログアウトに失敗したら検索し直す。
    サーバーは変更の流れをつなぐたびに今の本人を送るので、変わっていなければ何もしない(つなぎ直すたびに
    選択や一覧を消さない)。 -/
def notify (s : State P F) : Notice P → Step P F
  | .tilesIdentityChanged =>
    match s with
    | .loggedIn s =>
      if s.screen.isBusy then ⟨.loggedIn s, []⟩
      else ⟨.loggedOut (some identityChangedMessage) s.map, []⟩
    | s => ⟨s, []⟩
  | .mapMoved area =>
    match s with
    | .loggedOut err map => ⟨.loggedOut err (map.movedTo area), []⟩
    | .loggingIn email map => ⟨.loggingIn email (map.movedTo area), []⟩
    | .loggedIn s => { s with map := s.map.movedTo area }.searchTo s.screen
    | .loggingOut s => ⟨.loggingOut { s with map := s.map.movedTo area }, []⟩
  | .changed c =>
    match s with
    | .loggedIn s => if c.actor = s.me.id then onChanged s c else ⟨.loggedIn s, []⟩
    | s => ⟨s, []⟩
  | .resumed actor =>
    match s with
    | .loggedIn s => if actor = s.me.id then s.refreshTo s.screen else ⟨.loggedIn s, []⟩
    | s => ⟨s, []⟩
  | .permissionChanged me =>
    match s with
    | .loggedIn s =>
      if me.id = s.me.id ∧ me ≠ s.me then
        (s.withPermission me).refreshTo (s.withPermission me).screen
      else ⟨.loggedIn s, []⟩
    | .loggingOut s =>
      if me.id = s.me.id ∧ me ≠ s.me then ⟨.loggingOut (s.withPermission me), []⟩
      else ⟨.loggingOut s, []⟩
    | s => ⟨s, []⟩

end App
