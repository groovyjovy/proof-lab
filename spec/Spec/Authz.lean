import Spec.Domain

/-
認可の仕様。PostgreSQL の RLS(db/migrations/002_feature.sql)はこれを写したもので、
両者が同じ判断をすることは tests/properties で突き合わせる。SQL そのものは証明していない。

判断は「誰が」「どの地物を」だけで決まる。地物が何件あっても、どの出口から読んでも、
1件ずつ同じ判断をするので、ここで証明した性質は件数によらない。
-/
namespace Authz

open Domain

structure User where
  role : Role
  canEdit : Bool
  deriving DecidableEq, Repr

structure Feature where
  city : City
  isPublic : Bool
  deriving DecidableEq, Repr

/-- 認可の条件の式。Lean ではこの式を評価して性質を証明し、同じ式から PostgreSQL の関数を書き出す
    (`policySql`。db/migrations/002_feature.sql の生成部分)。証明した判断と SQL の判断がずれない。 -/
inductive Cond where
  | admin
  | viewer
  | canEdit
  | isPublic
  /-- 地物の市が、市職員の担当の市 -/
  | ownCity
  | not (c : Cond)
  | and (a b : Cond)
  | or (a b : Cond)

def Cond.eval (u : User) (f : Feature) : Cond → Bool
  | .admin => u.role == .admin
  | .viewer => u.role == .viewer
  | .canEdit => u.canEdit
  | .isPublic => f.isPublic
  | .ownCity => u.role.city? == some f.city
  | .not c => !c.eval u f
  | .and a b => a.eval u f && b.eval u f
  | .or a b => a.eval u f || b.eval u f

/-- SQL では、利用者の情報を DB から読む関数(`app_role()`・`app_can_edit()`)と、行の列(`city`・`public`)で書く。 -/
def Cond.sql : Cond → String
  | .admin => "app_role() = 'admin'"
  | .viewer => "app_role() = 'viewer'"
  | .canEdit => "app_can_edit()"
  | .isPublic => "public"
  | .ownCity => "city = city_of_role(app_role())"
  | .not c => s!"not ({c.sql})"
  | .and a b => s!"({a.sql} and {b.sql})"
  | .or a b => s!"({a.sql} or {b.sql})"

/-- 読める: 管理者は全部、閲覧者は公開の地物、市職員は担当の市の地物。 -/
def readCond : Cond := .or .admin (.or (.and .viewer .isPublic) .ownCity)

/-- 書き込める: 編集権限があり、管理者か、担当の市の地物。 -/
def writeCond : Cond := .and .canEdit (.or .admin .ownCity)

/-- `owner_name` が見える: 閲覧者以外。 -/
def ownerCond : Cond := .not .viewer

def canRead (u : User) (f : Feature) : Bool := readCond.eval u f

def canWrite (u : User) (f : Feature) : Bool := writeCond.eval u f

/-- 作成の `with check`: 書き込んだあとの行で見る。 -/
def canCreate (u : User) (f : Feature) : Bool := canWrite u f

/-- 編集の `using` と `with check`: 書き込む前と後の両方の行で見る。 -/
def canUpdate (u : User) (before after : Feature) : Bool := canWrite u before && canWrite u after

def seesOwner (u : User) (f : Feature) : Bool := ownerCond.eval u f

def sqlFunction (name : String) (c : Cond) : String :=
  s!"create function {name}(city text, public boolean) returns boolean\nlanguage sql stable as $$\n\tselect coalesce({c.sql}, false)\n$$;\n"

/-- db/migrations/002_feature.sql の生成部分。利用者が決まらない(`app_role()` が null)ときは、どれも false。 -/
def policySql : String :=
  sqlFunction "app_can_read" readCond ++ "\n" ++ sqlFunction "app_can_write" writeCond ++ "\n" ++
    sqlFunction "app_sees_owner" ownerCond

/-! ## 剥奪(P3)

編集権限は DB の `"user"` 表にあり、ログインしたときの値が Cookie cache にも入る。
Cookie cache は `maxAge` が切れるまで古いまま(goal.md 5章、測定済み)。
保存を認可するときに、どちらの値を見るかで P3 が分かれる。 -/

inductive Source where
  | db
  | cache

structure World where
  db : Bool
  cache : Bool
  revoked : Bool

inductive Event where
  | revoke
  | refresh

def World.step (w : World) : Event → World
  | .revoke => { w with db := false, revoked := true }
  | .refresh => { w with cache := w.db }

def World.run (w : World) (es : List Event) : World := es.foldl World.step w

def World.start : World := ⟨true, true, false⟩

def allows : Source → World → Bool
  | .db, w => w.db
  | .cache, w => w.cache

/-! ## 本人の一致(P11)

Cookie は同じブラウザのすべての画面で共有され、ほかの画面でログインし直すと置き換わる。
地図ライブラリは状態機械の外でタイルを取りに行くので、画面が表示している本人と、
サーバーが認可に使うセッションの本人がずれうる。要求には画面が表示している本人(`as`)を書き、
サーバーはセッションの本人と同じときだけ答える。 -/

def served (requested session : String) : Bool := requested == session

/-! ## 同時編集(P4)と作成の冪等性(P10) -/

structure Row where
  version : Nat
  edits : List String

/-- 保存は、読み込んだ版が今の版と同じときだけ通り、版を1つ上げる(`where version = $2`)。 -/
def Row.save (r : Row) (readVersion : Nat) (edit : String) : Option Row :=
  if readVersion = r.version then some ⟨r.version + 1, r.edits ++ [edit]⟩ else none

/-- 作成は、同じキーがもうあれば何もしない(`on conflict (request_key) do nothing`)。 -/
def create (store : List (String × α)) (key : String) (v : α) : List (String × α) :=
  if store.any (·.1 == key) then store else store ++ [(key, v)]

end Authz
