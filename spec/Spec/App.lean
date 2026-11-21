import Spec.Domain

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

structure Selected (P F : Type) where
  pos : P
  props : F

inductive Screen (P F : Type) where
  | view (selected : Option (Selected P F))
  | drawing (draft : Draft P) (failed : Bool)
  | saving (draft : Draft P)
  | unknown (draft : Draft P) (failed : Bool)
  | resaving (draft : Draft P)

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
  | clickMap (pos : P) (feature : Option F)
  | closePopup
  | startDrawing (key : String)
  | chooseCity (city : City)
  | choosePublic (isPublic : Bool)
  | commit
  | cancel
  | resend

inductive OpKind where
  | pressLogin | pressLogout | clickMap | closePopup | startDrawing
  | chooseCity | choosePublic | commit | cancel | resend
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

/-- 副作用の結果。届いた状態で必ず受け取らなければならない。 -/
inductive Reply where
  | loginOk (me : Me)
  | loginFailed (message : String)
  | logoutOk
  | logoutFailed
  | saved
  | rejected
  | unknown

inductive Effect (P : Type) where
  | login (email : String)
  | logout
  | save (draft : Draft P)

structure Step (P F : Type) where
  state : State P F
  effects : List (Effect P)

variable {P F : Type}

def Screen.isSaving : Screen P F → Bool
  | .saving _ | .resaving _ => true
  | _ => false

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
    | .view _ => some (s.to (.view (feature.map fun f => ⟨pos, f⟩)))
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
    | .drawing d _ => if 3 ≤ d.points.length then some (s.to (.saving d) [.save d]) else none
    | _ => none
  | .cancel =>
    match s.screen with
    | .drawing _ _ => some (s.to (.view none))
    | .unknown _ _ => some (s.refreshed.to (.view none))
    | _ => none
  | .resend =>
    match s.screen with
    | .unknown d _ => some (s.to (.resaving d) [.save d])
    | _ => none
  | .pressLogin _ | .pressLogout => none

/-- 操作を差し出しているなら、その遷移。差し出していなければ `none`。 -/
def perform : State P F → Op P F → Option (Step P F)
  | .loggedOut _, .pressLogin email => some ⟨.loggingIn email, [.login email]⟩
  | .loggedOut _, _ => none
  | .loggingIn _, _ => none
  | .loggingOut _, _ => none
  | .loggedIn s, .pressLogout =>
    if s.screen.isSaving then none else some ⟨.loggingOut s, [.logout]⟩
  | .loggedIn s, op => onScreen s op

def onReply (s : Session P F) : Reply → Option (Step P F)
  | .saved =>
    match s.screen with
    | .saving _ | .resaving _ => some (s.refreshed.to (.view none))
    | _ => none
  | .unknown =>
    match s.screen with
    | .saving d | .resaving d => some (s.to (.unknown d false))
    | _ => none
  | .rejected =>
    match s.screen with
    | .saving d => some (s.to (.drawing d true))
    | .resaving d => some (s.to (.unknown d true))
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

end App
