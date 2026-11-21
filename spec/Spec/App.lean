import Spec.Domain
import Spec.Authz

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
  deriving DecidableEq, Repr

def Ref.feature (r : Ref) : Authz.Feature := ⟨r.city, r.isPublic⟩

structure Selected (P F : Type) where
  pos : P
  ref : Ref
  props : F

/-- 編集中の値。版(`version`)は、サーバーから読み込んだときのもの。 -/
structure Edit where
  ref : Ref
  version : Nat
  name : String
  note : String
  deriving DecidableEq, Repr

inductive Screen (P F : Type) where
  | view (selected : Option (Selected P F))
  | drawing (draft : Draft P) (failed : Bool)
  | saving (draft : Draft P)
  | unknown (draft : Draft P) (failed : Bool)
  | resaving (draft : Draft P)
  /-- 編集するために、地物の今の版を読み込んでいる -/
  | loading (ref : Ref)
  | editing (edit : Edit) (failed : Bool)
  /-- 更新を送った。キーは、この中身の更新を表す(P12) -/
  | updating (edit : Edit) (key : String)
  | updateUnknown (edit : Edit) (key : String) (failed : Bool)
  /-- ほかの人が先に保存していた(P4)。読み直すまで更新を送らない -/
  | conflicted (edit : Edit)

structure Session (P F : Type) where
  me : Me
  tiles : Nat
  screen : Screen P F

inductive State (P F : Type) where
  | loggedOut (error : Option String)
  | loggingIn (email : String)
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
  | saveEdit (key : String)
  | reload

inductive OpKind where
  | pressLogin | pressLogout | clickMap | closePopup | startDrawing
  | chooseCity | choosePublic | commit | cancel | resend
  | startEdit | editName | editNote | saveEdit | reload
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
  | .saveEdit _ => .saveEdit
  | .reload => .reload

/-- 副作用の結果。届いた状態で必ず受け取らなければならない。 -/
inductive Reply where
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

/-- 副作用とは関係なく届く知らせ。どの状態でも受け取る。
    地図ライブラリは状態機械の外でタイルを取りに行くので、その失敗はここに届く。 -/
inductive Notice where
  /-- タイルの要求に書いた本人と、サーバーのセッションの本人が違った(P11)。 -/
  | tilesIdentityChanged

inductive Effect (P : Type) where
  | login (email : String)
  | logout
  /-- 保存は、画面が本人として表示している利用者(`actor`)として送る(P11)。 -/
  | save (draft : Draft P) (actor : String)
  | load (id : Nat) (actor : String)
  | update (edit : Edit) (key : String) (actor : String)

structure Step (P F : Type) where
  state : State P F
  effects : List (Effect P)

variable {P F : Type}

/-- 副作用の応答を待っている。この間は、ほかの副作用を出さない(飛んでいる副作用は高々1つ)。 -/
def Screen.isBusy : Screen P F → Bool
  | .saving _ | .resaving _ | .loading _ | .updating _ _ => true
  | _ => false

/-- 本人が、選んだ地物を編集できるか。サーバーの RLS と同じ判断(`Authz.canWrite`)を使う。 -/
def canEditFeature (me : Me) (ref : Ref) : Bool :=
  Authz.canWrite ⟨me.role, me.canEdit⟩ ref.feature

def init (me : Option Me) : State P F :=
  match me with
  | some me => .loggedIn { me, tiles := 0, screen := .view none }
  | none => .loggedOut none

def Session.to (s : Session P F) (screen : Screen P F) (effects : List (Effect P) := []) :
    Step P F :=
  ⟨.loggedIn { s with screen }, effects⟩

/-- 保存が終わった(または取り消した)ので、タイルを読み直す。 -/
def Session.refreshed (s : Session P F) : Session P F :=
  { s with tiles := s.tiles + 1 }

def onScreen (s : Session P F) : Op P F → Option (Step P F)
  | .clickMap pos feature =>
    match s.screen with
    | .view _ => some (s.to (.view (feature.map fun (ref, props) => ⟨pos, ref, props⟩)))
    | .drawing d failed => some (s.to (.drawing { d with points := d.points ++ [pos] } failed))
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
      if 3 ≤ d.points.length then some (s.to (.saving d) [.save d s.me.id]) else none
    | _ => none
  | .cancel =>
    match s.screen with
    | .drawing _ _ | .editing _ _ | .conflicted _ => some (s.to (.view none))
    | .unknown _ _ | .updateUnknown _ _ _ => some (s.refreshed.to (.view none))
    | _ => none
  | .resend =>
    match s.screen with
    | .unknown d _ => some (s.to (.resaving d) [.save d s.me.id])
    | .updateUnknown e key _ => some (s.to (.updating e key) [.update e key s.me.id])
    | _ => none
  | .startEdit =>
    match s.screen with
    | .view (some sel) =>
      if canEditFeature s.me sel.ref then some (s.to (.loading sel.ref) [.load sel.ref.id s.me.id])
      else none
    | _ => none
  | .editName name =>
    match s.screen with
    | .editing e failed => some (s.to (.editing { e with name } failed))
    | _ => none
  | .editNote note =>
    match s.screen with
    | .editing e failed => some (s.to (.editing { e with note } failed))
    | _ => none
  | .saveEdit key =>
    match s.screen with
    | .editing e _ => some (s.to (.updating e key) [.update e key s.me.id])
    | _ => none
  | .reload =>
    match s.screen with
    | .conflicted e => some (s.to (.loading e.ref) [.load e.ref.id s.me.id])
    | _ => none
  | .pressLogin _ | .pressLogout => none

/-- 操作を差し出しているなら、その遷移。差し出していなければ `none`。 -/
def perform : State P F → Op P F → Option (Step P F)
  | .loggedOut _, .pressLogin email => some ⟨.loggingIn email, [.login email]⟩
  | .loggedOut _, _ => none
  | .loggingIn _, _ => none
  | .loggingOut _, _ => none
  | .loggedIn s, .pressLogout =>
    if s.screen.isBusy then none else some ⟨.loggingOut s, [.logout]⟩
  | .loggedIn s, op => onScreen s op

def identityChangedMessage : String :=
  "ほかの画面で別の利用者としてログインしたため、この画面での操作を止めました。もう一度ログインしてください"

def onReply (s : Session P F) : Reply → Option (Step P F)
  | .saved =>
    match s.screen with
    | .saving _ | .resaving _ | .updating _ _ => some (s.refreshed.to (.view none))
    | _ => none
  | .unknown =>
    match s.screen with
    | .saving d | .resaving d => some (s.to (.unknown d false))
    | .updating e key => some (s.to (.updateUnknown e key false))
    | _ => none
  | .rejected =>
    match s.screen with
    | .saving d => some (s.to (.drawing d true))
    | .resaving d => some (s.to (.unknown d true))
    | .updating e _ => some (s.to (.editing e true))
    | _ => none
  | .identityChanged =>
    if s.screen.isBusy then some ⟨.loggedOut (some identityChangedMessage), []⟩ else none
  | .loaded e =>
    match s.screen with
    | .loading _ => some (s.to (.editing e false))
    | _ => none
  | .loadFailed =>
    match s.screen with
    | .loading _ => some (s.to (.view none))
    | _ => none
  | .conflict =>
    match s.screen with
    | .updating e _ => some (s.to (.conflicted e))
    | _ => none
  | _ => none

/-- 応答を受け取った遷移。受け取れなければ `none`(実装では例外にする)。 -/
def receive : State P F → Reply → Option (Step P F)
  | .loggingIn _, .loginOk me => some ⟨init (some me), []⟩
  | .loggingIn _, .loginFailed message => some ⟨.loggedOut (some message), []⟩
  | .loggingOut _, .logoutOk => some ⟨.loggedOut none, []⟩
  | .loggingOut s, .logoutFailed => some ⟨.loggedIn s, []⟩
  | .loggedIn s, r => onReply s r
  | _, _ => none

/-- 知らせの受け取り。どの状態でも受け取る(`Option` ではない)。
    副作用の応答を待っている間は、その応答を捨てないように何もしない。
    要求にはどれも本人を書いてあるので、本人が変わっていればその応答で分かる。 -/
def notify : State P F → Notice → Step P F
  | .loggedIn s, .tilesIdentityChanged =>
    if s.screen.isBusy then ⟨.loggedIn s, []⟩
    else ⟨.loggedOut (some identityChangedMessage), []⟩
  | s, .tilesIdentityChanged => ⟨s, []⟩

end App
