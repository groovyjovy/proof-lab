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
  Json.mkObj [("id", toJson me.id), ("name", toJson me.name), ("role", toJson (roleName me.role)),
    ("canEdit", toJson me.canEdit)]

def meOf? (j : Json) : Except String Me := do
  return { id := ← j.getObjValAs? String "id"
           name := ← j.getObjValAs? String "name"
           role := ← roleOf? (← j.getObjValAs? String "role")
           canEdit := ← j.getObjValAs? Bool "canEdit" }

def draftToJson (d : Draft Json) : Json :=
  Json.mkObj [("key", toJson d.key), ("city", toJson (cityName d.city)),
    ("public", toJson d.isPublic), ("points", Json.arr d.points.toArray)]

def draftOf? (j : Json) : Except String (Draft Json) := do
  return { key := ← j.getObjValAs? String "key"
           city := ← cityOf? (← j.getObjValAs? String "city")
           isPublic := ← j.getObjValAs? Bool "public"
           points := (← (← j.getObjVal? "points").getArr?).toList }

/-- 結果の知らせ(`notice`)は、決まった文字列か `null`。 -/
def refToJson (r : Ref) : Json :=
  Json.mkObj ([("id", toJson r.id), ("city", toJson (cityName r.city)), ("public", toJson r.isPublic)] ++
    (r.version.toList.map fun v => ("version", toJson v)))

def refOf? (j : Json) : Except String Ref := do
  return { id := ← j.getObjValAs? Nat "id"
           city := ← cityOf? (← j.getObjValAs? String "city")
           isPublic := ← j.getObjValAs? Bool "public"
           version := (j.getObjValAs? Nat "version").toOption }

def boundaryToJson (b : BoundaryEdit) : Json :=
  Json.mkObj [("neighborId", toJson b.neighborId), ("neighborVersion", toJson b.neighborVersion),
    ("position", toJson b.position), ("verifiedVersion", nullable (b.verifiedVersion.map toJson)),
    ("draft", nullable (b.draft.map toJson))]

def boundaryOf? (j : Json) : Except String BoundaryEdit := do
  return { neighborId := ← j.getObjValAs? Nat "neighborId"
           neighborVersion := ← j.getObjValAs? Nat "neighborVersion"
           position := ← j.getObjValAs? Nat "position"
           verifiedVersion := (j.getObjValAs? Nat "verifiedVersion").toOption
           draft := (j.getObjValAs? Nat "draft").toOption }

def editToJson (e : Edit) : Json :=
  Json.mkObj ([("ref", refToJson e.ref), ("version", toJson e.version), ("name", toJson e.name),
    ("note", toJson e.note)] ++ (e.boundary.toList.map fun b => ("boundary", boundaryToJson b)))

def editOf? (j : Json) : Except String Edit := do
  return { ref := ← refOf? (← j.getObjVal? "ref")
           version := ← j.getObjValAs? Nat "version"
           name := ← j.getObjValAs? String "name"
           note := ← j.getObjValAs? String "note"
           boundary := ((j.getObjVal? "boundary").bind boundaryOf?).toOption }

def areaToJson (a : Area Json) : Json := Json.arr #[a.1, a.2]

def areaOf? (j : Json) : Except String (Area Json) := do
  match (← j.getArr?).toList with
  | [sw, ne] => return (sw, ne)
  | _ => throw s!"範囲は2点: {j.compress}"

def queryToJson (q : Query Json) : Json :=
  Json.mkObj [("seq", toJson q.seq), ("area", areaToJson q.area)]

def queryOf? (j : Json) : Except String (Query Json) := do
  return ⟨← j.getObjValAs? Nat "seq", ← areaOf? (← j.getObjVal? "area")⟩

def hitToJson (h : Ref × Json) : Json :=
  Json.mkObj [("ref", refToJson h.1), ("properties", h.2)]

def hitOf? (j : Json) : Except String (Ref × Json) := do
  return (← refOf? (← j.getObjVal? "ref"), ← j.getObjVal? "properties")

def hitsOf? (j : Json) : Except String (List (Ref × Json)) := do
  (← j.getArr?).toList.mapM hitOf?

def mapToJson (m : MapView Json) : Json :=
  Json.mkObj [("area", nullable (m.area.map areaToJson)), ("issued", toJson m.issued)]

def mapOf? (j : Json) : Except String (MapView Json) := do
  let a ← j.getObjVal? "area"
  return ⟨← if a == .null then pure none else some <$> areaOf? a, ← j.getObjValAs? Nat "issued"⟩

def listingToJson : Listing Json Json → Json
  | .found q hits =>
    Json.mkObj [("kind", "見つかった"), ("query", queryToJson q),
      ("hits", Json.arr (hits.map hitToJson).toArray)]
  | .failed q => Json.mkObj [("kind", "検索できない"), ("query", queryToJson q)]

def listingOf? (j : Json) : Except String (Listing Json Json) := do
  match ← j.getObjValAs? String "kind" with
  | "見つかった" => return .found (← queryOf? (← j.getObjVal? "query")) (← hitsOf? (← j.getObjVal? "hits"))
  | "検索できない" => return .failed (← queryOf? (← j.getObjVal? "query"))
  | k => throw s!"知らない一覧: {k}"

def searchToJson (s : Search Json Json) : Json :=
  Json.mkObj [("pending", nullable (s.pending.map queryToJson)),
    ("shown", nullable (s.shown.map listingToJson)), ("since", toJson s.since)]

def searchOf? (j : Json) : Except String (Search Json Json) := do
  let p ← j.getObjVal? "pending"
  let l ← j.getObjVal? "shown"
  return ⟨← if p == .null then pure none else some <$> queryOf? p,
    ← if l == .null then pure none else some <$> listingOf? l, ← j.getObjValAs? Nat "since"⟩

def noticeFlag? (j : Json) (expected : String) : Except String Bool := do
  let n ← j.getObjVal? "notice"
  if n == .null then return false
  if n == toJson expected then return true
  throw s!"知らない知らせ: {n.compress}"

def screenOf? (j : Json) : Except String (Screen Json Json) := do
  match ← j.getObjValAs? String "kind" with
  | "閲覧" =>
    let sel ← j.getObjVal? "selected"
    if sel == .null then return .view none
    return .view (some ⟨← sel.getObjVal? "at", ← refOf? (← sel.getObjVal? "ref"),
      ← sel.getObjVal? "properties"⟩)
  | "描画中" => return .drawing (← draftOf? (← j.getObjVal? "draft")) (← noticeFlag? j "保存失敗")
  | "保存中" => return .saving (← draftOf? (← j.getObjVal? "draft"))
  | "結果不明" => return .unknown (← draftOf? (← j.getObjVal? "draft")) (← noticeFlag? j "再送失敗")
  | "再送中" => return .resaving (← draftOf? (← j.getObjVal? "draft"))
  | "読込中" => return .loading (← refOf? (← j.getObjVal? "ref"))
  | "編集中" =>
    return .editing (← editOf? (← j.getObjVal? "edit")) (← noticeFlag? j "更新失敗")
      (← j.getObjValAs? Bool "stale")
  | "更新中" =>
    return .updating (← editOf? (← j.getObjVal? "edit")) (← j.getObjValAs? String "key")
      (← j.getObjValAs? Bool "applied")
  | "更新結果不明" =>
    return .updateUnknown (← editOf? (← j.getObjVal? "edit")) (← j.getObjValAs? String "key")
      (← noticeFlag? j "再送失敗")
  | "更新の再送中" =>
    return .reupdating (← editOf? (← j.getObjVal? "edit")) (← j.getObjValAs? String "key")
      (← j.getObjValAs? Bool "applied")
  | "競合" => return .conflicted (← editOf? (← j.getObjVal? "edit"))
  | k => throw s!"知らない画面: {k}"

def sessionOf? (j : Json) : Except String (Session Json Json) := do
  return { me := ← meOf? (← j.getObjVal? "me")
           tiles := ← j.getObjValAs? Nat "tiles"
           screen := ← screenOf? (← j.getObjVal? "screen")
           map := ← mapOf? (← j.getObjVal? "map")
           search := ← searchOf? (← j.getObjVal? "search")
           mapLag := (j.getObjValAs? (Nat × Nat) "mapLag").toOption }

def stateOf? (j : Json) : Except String S := do
  match ← j.getObjValAs? String "kind" with
  | "未ログイン" =>
    let e ← j.getObjVal? "error"
    let map ← mapOf? (← j.getObjVal? "map")
    if e == .null then return .loggedOut none map
    return .loggedOut (some (← e.getStr?)) map
  | "ログイン中" => return .loggingIn (← j.getObjValAs? String "email") (← mapOf? (← j.getObjVal? "map"))
  | "ログイン済み" => return .loggedIn (← sessionOf? j)
  | "ログアウト中" => return .loggingOut (← sessionOf? (← j.getObjVal? "from"))
  | k => throw s!"知らない状態: {k}"

def screenToJson : Screen Json Json → Json
  | .view sel =>
    Json.mkObj [("kind", "閲覧"),
      ("selected", nullable (sel.map fun s =>
        Json.mkObj [("at", s.pos), ("ref", refToJson s.ref), ("properties", s.props)]))]
  | .drawing d failed =>
    Json.mkObj [("kind", "描画中"), ("draft", draftToJson d),
      ("notice", if failed then "保存失敗" else .null)]
  | .saving d => Json.mkObj [("kind", "保存中"), ("draft", draftToJson d)]
  | .unknown d failed =>
    Json.mkObj [("kind", "結果不明"), ("draft", draftToJson d),
      ("notice", if failed then "再送失敗" else .null)]
  | .resaving d => Json.mkObj [("kind", "再送中"), ("draft", draftToJson d)]
  | .loading r => Json.mkObj [("kind", "読込中"), ("ref", refToJson r)]
  | .editing e failed stale =>
    Json.mkObj [("kind", "編集中"), ("edit", editToJson e), ("notice", if failed then "更新失敗" else .null),
      ("stale", toJson stale)]
  | .updating e key applied =>
    Json.mkObj [("kind", "更新中"), ("edit", editToJson e), ("key", toJson key),
      ("applied", toJson applied)]
  | .updateUnknown e key failed =>
    Json.mkObj [("kind", "更新結果不明"), ("edit", editToJson e), ("key", toJson key),
      ("notice", if failed then "再送失敗" else .null)]
  | .reupdating e key applied =>
    Json.mkObj [("kind", "更新の再送中"), ("edit", editToJson e), ("key", toJson key),
      ("applied", toJson applied)]
  | .conflicted e => Json.mkObj [("kind", "競合"), ("edit", editToJson e)]

def sessionToJson (s : Session Json Json) : Json :=
  Json.mkObj [("kind", "ログイン済み"), ("me", meToJson s.me), ("tiles", toJson s.tiles),
    ("screen", screenToJson s.screen), ("map", mapToJson s.map), ("search", searchToJson s.search),
    ("mapLag", nullable (s.mapLag.map toJson))]

def stateToJson : S → Json
  | .loggedOut err map =>
    Json.mkObj [("kind", "未ログイン"), ("error", nullable (err.map toJson)), ("map", mapToJson map)]
  | .loggingIn email map =>
    Json.mkObj [("kind", "ログイン中"), ("email", toJson email), ("map", mapToJson map)]
  | .loggedIn s => sessionToJson s
  | .loggingOut s => Json.mkObj [("kind", "ログアウト中"), ("from", sessionToJson s)]

def effectToJson : Effect Json → Json
  | .login email => Json.mkObj [("type", "ログインする"), ("email", toJson email)]
  | .logout => Json.mkObj [("type", "ログアウトする")]
  | .save d actor => Json.mkObj [("type", "保存する"), ("draft", draftToJson d), ("as", toJson actor)]
  | .load id actor => Json.mkObj [("type", "読み込む"), ("id", toJson id), ("as", toJson actor)]
  | .update e key actor =>
    Json.mkObj [("type", "更新する"), ("edit", editToJson e), ("key", toJson key), ("as", toJson actor)]
  | .search q actor => Json.mkObj [("type", "検索する"), ("query", queryToJson q), ("as", toJson actor)]

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
  | .startEdit => "編集を始める"
  | .editName => "名前を変える"
  | .editNote => "備考を変える"
  | .moveBoundary => "境界を動かす"
  | .saveEdit => "編集を保存"
  | .reload => "読み直す"

def opOf? (j : Json) : Except String (Op Json Json) := do
  match ← j.getObjValAs? String "type" with
  | "ログインを押す" => return .pressLogin (← j.getObjValAs? String "email")
  | "ログアウトを押す" => return .pressLogout
  | "地図をクリック" =>
    let feature ← j.getObjVal? "feature"
    if feature == .null then return .clickMap (← j.getObjVal? "at") none
    return .clickMap (← j.getObjVal? "at")
      (some (← refOf? (← feature.getObjVal? "ref"), ← feature.getObjVal? "properties"))
  | "ポップアップを閉じる" => return .closePopup
  | "描画開始" => return .startDrawing (← j.getObjValAs? String "key")
  | "市を選ぶ" => return .chooseCity (← cityOf? (← j.getObjValAs? String "city"))
  | "公開を選ぶ" => return .choosePublic (← j.getObjValAs? Bool "public")
  | "確定" => return .commit
  | "取消" => return .cancel
  | "再送" => return .resend
  | "編集を始める" => return .startEdit
  | "名前を変える" => return .editName (← j.getObjValAs? String "name")
  | "備考を変える" => return .editNote (← j.getObjValAs? String "note")
  | "境界を動かす" => return .moveBoundary (← j.getObjValAs? Nat "position")
  | "編集を保存" => return .saveEdit (← j.getObjValAs? String "key")
  | "読み直す" => return .reload
  | t => throw s!"知らない操作: {t}"

def searchResultOf? (j : Json) : Except String (SearchResult Json) := do
  match ← j.getObjValAs? String "type" with
  | "見つかった" => return .found (← hitsOf? (← j.getObjVal? "hits"))
  | "検索できない" => return .failed
  | "本人が変わった" => return .identityChanged
  | t => throw s!"知らない検索の結果: {t}"

def replyOf? (j : Json) : Except String (Reply Json) := do
  match ← j.getObjValAs? String "type" with
  | "ログイン成功" => return .loginOk (← meOf? (← j.getObjVal? "me"))
  | "ログイン失敗" => return .loginFailed (← j.getObjValAs? String "message")
  | "ログアウト完了" => return .logoutOk
  | "ログアウト失敗" => return .logoutFailed
  | "保存成功" => return .saved
  | "保存失敗" => return .rejected
  | "保存結果不明" => return .unknown
  | "本人が変わった" => return .identityChanged
  | "読み込めた" => return .loaded (← editOf? (← j.getObjVal? "edit"))
  | "読み込めない" => return .loadFailed
  | "競合した" => return .conflict
  | "検索の応答" =>
    return .searched (← j.getObjValAs? Nat "seq") (← searchResultOf? (← j.getObjVal? "result"))
  | t => throw s!"知らない応答: {t}"

def noticeOf? (j : Json) : Except String (Notice Json) := do
  match ← j.getObjValAs? String "type" with
  | "地図の本人が変わった" => return .tilesIdentityChanged
  | "地図が動いた" => return .mapMoved (← areaOf? (← j.getObjVal? "area"))
  | "地物が変わった" =>
    let c ← j.getObjVal? "change"
    return .changed { id := ← c.getObjValAs? Nat "id", version := ← c.getObjValAs? Nat "version",
                      key := ← c.getObjValAs? String "key", actor := ← c.getObjValAs? String "as" }
  | "変更の流れをつなぎ直した" => return .resumed (← j.getObjValAs? String "as")
  | "権限が変わった" => return .permissionChanged (← meOf? (← j.getObjVal? "me"))
  | t => throw s!"知らない知らせ: {t}"

/-- 差し出している操作の名前。差し出すかどうかは操作の中身によらない(`offer_depends_on_kind_only`)
    ので、種類ごとに1つの見本で調べれば足りる。 -/
def offered (s : S) : List String :=
  let samples : List (Op Json Json) :=
    [.pressLogin "", .pressLogout, .clickMap .null none, .closePopup, .startDrawing "",
      .chooseCity .a, .choosePublic false, .commit, .cancel, .resend, .startEdit, .editName "",
      .editNote "", .moveBoundary 0, .saveEdit "", .reload]
  samples.filterMap fun op => (perform s op).map fun _ => opKindName op.kind

def snapshot (s : S) (effects : List (Effect Json)) : Json :=
  Json.mkObj [("state", stateToJson s), ("effects", Json.arr (effects.map effectToJson).toArray),
    ("offers", toJson (offered s))]

/-- 操作・応答・知らせを1つ当てる。差し出していない操作・受け取れない応答は `none`。 -/
def applyEvent (s : S) (e : Json) : Except String (Option (Step Json Json)) :=
  match e.getObjVal? "op", e.getObjVal? "reply", e.getObjVal? "notice" with
  | .ok op, _, _ => return perform s (← opOf? op)
  | _, .ok r, _ => return receive s (← replyOf? r)
  | _, _, .ok n => return some (notify s (← noticeOf? n))
  | _, _, _ => throw "op か reply か notice が要る"

def stepToJson : Option (Step Json Json) → Json
  | some st => snapshot st.state st.effects
  | none => .null

/-- 与えた状態に、イベントを1つずつ別々に当てた結果。範囲内の網羅に使う。 -/
def branch (j : Json) : Except String Json := do
  let s ← stateOf? (← j.getObjVal? "state")
  let mut out : Array Json := #[]
  for e in ← (← j.getObjVal? "branches").getArr? do
    out := out.push (stepToJson (← applyEvent s e))
  return Json.mkObj [("snapshot", snapshot s []), ("branches", Json.arr out)]

/-- 画面の状態機械: 初期状態から操作・応答・知らせを順に流し、1つずつの結果を返す。
    差し出していない操作・受け取れない応答は `null` で、状態は変わらない。知らせは必ず受け取る。 -/
def runTrace (j : Json) : Except String Json := do
  let meJson ← j.getObjVal? "me"
  let me ← if meJson == .null then pure none else some <$> meOf? meJson
  let initial : S := init me
  let mut s := initial
  let mut steps : Array Json := #[]
  for e in ← (← j.getObjVal? "events").getArr? do
    match ← applyEvent s e with
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
            ("canRead", toJson (Authz.canRead u f)), ("canWrite", toJson (Authz.canWrite u f)),
            ("seesOwner", toJson (Authz.seesOwner u f))]
  return Json.arr rows

def respond (line : String) : Except String Json := do
  let j ← Json.parse line
  if (j.getObjVal? "authzTable").toOption.isSome then return authzTable
  if (j.getObjVal? "policySql").toOption.isSome then return Json.mkObj [("sql", toJson Authz.policySql)]
  if (j.getObjVal? "state").toOption.isSome then return ← branch j
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
