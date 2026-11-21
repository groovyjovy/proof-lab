import Spec
import Lean.Data.Json

/-
仕様を実行する窓口。1行に1つの JSON を受け取り、1行で答える。
TypeScript の実装と突き合わせるために使う(tests/conformance と tests/properties)。
JSON の形は src/lib/app/machine.ts の型と同じ。座標と地物の属性は、中身を見ずにそのまま通す。
-/
open Lean Domain App

abbrev S := State Json Json

def roleName : Role → String
  | .admin => "admin"
  | .aStaff => "a-staff"
  | .bStaff => "b-staff"
  | .viewer => "viewer"

def roleOf? : String → Except String Role
  | "admin" => pure .admin
  | "a-staff" => pure .aStaff
  | "b-staff" => pure .bStaff
  | "viewer" => pure .viewer
  | s => throw s!"知らないロール: {s}"

def cityName : City → String
  | .a => "A"
  | .b => "B"

def cityOf? : String → Except String City
  | "A" => pure .a
  | "B" => pure .b
  | s => throw s!"知らない市: {s}"

def nullable : Option Json → Json
  | some j => j
  | none => .null

def meToJson (me : Me) : Json :=
  Json.mkObj [("name", toJson me.name), ("role", toJson (roleName me.role)),
    ("canEdit", toJson me.canEdit)]

def meOf? (j : Json) : Except String Me := do
  return { name := ← j.getObjValAs? String "name"
           role := ← roleOf? (← j.getObjValAs? String "role")
           canEdit := ← j.getObjValAs? Bool "canEdit" }

def draftToJson (d : Draft Json) : Json :=
  Json.mkObj [("key", toJson d.key), ("city", toJson (cityName d.city)),
    ("public", toJson d.isPublic), ("points", Json.arr d.points.toArray)]

def screenToJson : Screen Json Json → Json
  | .view sel =>
    Json.mkObj [("kind", "閲覧"),
      ("selected", nullable (sel.map fun s => Json.mkObj [("at", s.pos), ("properties", s.props)]))]
  | .drawing d failed =>
    Json.mkObj [("kind", "描画中"), ("draft", draftToJson d),
      ("notice", if failed then "保存失敗" else .null)]
  | .saving d => Json.mkObj [("kind", "保存中"), ("draft", draftToJson d)]
  | .unknown d failed =>
    Json.mkObj [("kind", "結果不明"), ("draft", draftToJson d),
      ("notice", if failed then "再送失敗" else .null)]
  | .resaving d => Json.mkObj [("kind", "再送中"), ("draft", draftToJson d)]

def sessionToJson (s : Session Json Json) : Json :=
  Json.mkObj [("kind", "ログイン済み"), ("me", meToJson s.me), ("tiles", toJson s.tiles),
    ("screen", screenToJson s.screen)]

def stateToJson : S → Json
  | .loggedOut err => Json.mkObj [("kind", "未ログイン"), ("error", nullable (err.map toJson))]
  | .loggingIn email => Json.mkObj [("kind", "ログイン中"), ("email", toJson email)]
  | .loggedIn s => sessionToJson s
  | .loggingOut s => Json.mkObj [("kind", "ログアウト中"), ("from", sessionToJson s)]

def effectToJson : Effect Json → Json
  | .login email => Json.mkObj [("type", "ログインする"), ("email", toJson email)]
  | .logout => Json.mkObj [("type", "ログアウトする")]
  | .save d => Json.mkObj [("type", "保存する"), ("draft", draftToJson d)]

def opKindName : OpKind → String
  | .pressLogin => "ログインを押す"
  | .pressLogout => "ログアウトを押す"
  | .clickMap => "地図をクリック"
  | .closePopup => "ポップアップを閉じる"
  | .startDrawing => "描画開始"
  | .chooseCity => "市を選ぶ"
  | .choosePublic => "公開を選ぶ"
  | .commit => "確定"
  | .cancel => "取消"
  | .resend => "再送"

def opOf? (j : Json) : Except String (Op Json Json) := do
  match ← j.getObjValAs? String "type" with
  | "ログインを押す" => return .pressLogin (← j.getObjValAs? String "email")
  | "ログアウトを押す" => return .pressLogout
  | "地図をクリック" =>
    let feature ← j.getObjVal? "feature"
    return .clickMap (← j.getObjVal? "at") (if feature == .null then none else some feature)
  | "ポップアップを閉じる" => return .closePopup
  | "描画開始" => return .startDrawing (← j.getObjValAs? String "key")
  | "市を選ぶ" => return .chooseCity (← cityOf? (← j.getObjValAs? String "city"))
  | "公開を選ぶ" => return .choosePublic (← j.getObjValAs? Bool "public")
  | "確定" => return .commit
  | "取消" => return .cancel
  | "再送" => return .resend
  | t => throw s!"知らない操作: {t}"

def replyOf? (j : Json) : Except String Reply := do
  match ← j.getObjValAs? String "type" with
  | "ログイン成功" => return .loginOk (← meOf? (← j.getObjVal? "me"))
  | "ログイン失敗" => return .loginFailed (← j.getObjValAs? String "message")
  | "ログアウト完了" => return .logoutOk
  | "ログアウト失敗" => return .logoutFailed
  | "保存成功" => return .saved
  | "保存失敗" => return .rejected
  | "保存結果不明" => return .unknown
  | t => throw s!"知らない応答: {t}"

/-- 差し出している操作の名前。差し出すかどうかは操作の中身によらない(`offer_depends_on_kind_only`)
    ので、種類ごとに1つの見本で調べれば足りる。 -/
def offered (s : S) : List String :=
  let samples : List (Op Json Json) :=
    [.pressLogin "", .pressLogout, .clickMap .null none, .closePopup, .startDrawing "",
      .chooseCity .a, .choosePublic false, .commit, .cancel, .resend]
  samples.filterMap fun op => (perform s op).map fun _ => opKindName op.kind

def snapshot (s : S) (effects : List (Effect Json)) : Json :=
  Json.mkObj [("state", stateToJson s), ("effects", Json.arr (effects.map effectToJson).toArray),
    ("offers", toJson (offered s))]

/-- 画面の状態機械: 初期状態から操作と応答を順に流し、1つずつの結果を返す。
    差し出していない操作・受け取れない応答は `null` で、状態は変わらない。 -/
def runTrace (j : Json) : Except String Json := do
  let meJson ← j.getObjVal? "me"
  let me ← if meJson == .null then pure none else some <$> meOf? meJson
  let initial : S := init me
  let mut s := initial
  let mut steps : Array Json := #[]
  for e in ← (← j.getObjVal? "events").getArr? do
    let step? ← match e.getObjVal? "op", e.getObjVal? "reply" with
      | .ok op, _ => pure (perform s (← opOf? op))
      | _, .ok r => pure (receive s (← replyOf? r))
      | _, _ => throw "op か reply が要る"
    match step? with
    | some st =>
      s := st.state
      steps := steps.push (snapshot st.state st.effects)
    | none => steps := steps.push .null
  return Json.mkObj [("initial", snapshot initial []), ("steps", Json.arr steps)]

/-- 認可: 利用者と地物のすべての組み合わせについての判断の表。 -/
def authzTable : Json := Id.run do
  let mut rows : Array Json := #[]
  for role in [Role.admin, .aStaff, .bStaff, .viewer] do
    for canEdit in [true, false] do
      for city in [City.a, .b] do
        for isPublic in [true, false] do
          let u : Authz.User := ⟨role, canEdit⟩
          let f : Authz.Feature := ⟨city, isPublic⟩
          rows := rows.push <| Json.mkObj [
            ("role", toJson (roleName role)), ("canEdit", toJson canEdit),
            ("city", toJson (cityName city)), ("public", toJson isPublic),
            ("canRead", toJson (Authz.canRead u f)), ("canWrite", toJson (Authz.canWrite u city)),
            ("seesOwner", toJson (Authz.seesOwner u))]
  return Json.arr rows

def respond (line : String) : Except String Json := do
  let j ← Json.parse line
  if (j.getObjVal? "authzTable").toOption.isSome then return authzTable
  runTrace j

partial def loop (stdin : IO.FS.Stream) (stdout : IO.FS.Stream) : IO Unit := do
  let line ← stdin.getLine
  if line.isEmpty then return
  let answer := match respond line with
    | .ok j => j
    | .error e => Json.mkObj [("error", toJson e)]
  stdout.putStrLn answer.compress
  stdout.flush
  loop stdin stdout

def main : IO Unit := do
  loop (← IO.getStdin) (← IO.getStdout)
