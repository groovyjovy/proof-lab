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

/-- `app_can_read`: 管理者は全部、閲覧者は公開の地物、市職員は担当の市の地物。 -/
def canRead (u : User) (f : Feature) : Bool :=
  u.role == .admin || (u.role == .viewer && f.isPublic) || u.role.city? == some f.city

/-- `app_can_write`: 編集権限があり、管理者か、担当の市の地物。 -/
def canWrite (u : User) (city : City) : Bool :=
  u.canEdit && (u.role == .admin || u.role.city? == some city)

/-- 作成の `with check`: 書き込んだあとの行で見る。 -/
def canCreate (u : User) (f : Feature) : Bool := canWrite u f.city

/-- 編集の `using` と `with check`: 書き込む前と後の両方の行で見る。 -/
def canUpdate (u : User) (before after : Feature) : Bool :=
  canWrite u before.city && canWrite u after.city

/-- `feature_visible`: 閲覧者には `owner_name` を返さない。 -/
def seesOwner (u : User) : Bool := u.role != .viewer

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
