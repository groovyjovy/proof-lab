/-
画面と認可で共有する型。TypeScript の src/lib/domain.ts に対応する。
-/
namespace Domain

inductive Role where
  | admin | aStaff | bStaff | viewer
  deriving DecidableEq, Repr

inductive City where
  | a | b
  deriving DecidableEq, Repr

structure Me where
  name : String
  role : Role
  canEdit : Bool
  deriving DecidableEq, Repr

/-- 市職員が描く地物の市。管理者は描画中に選べる(初期値は A 市)。 -/
def Me.home (me : Me) : City :=
  match me.role with
  | .bStaff => .b
  | _ => .a


/-- 市職員の担当の市。管理者と閲覧者にはない。 -/
def Role.city? : Role → Option City
  | .aStaff => some .a
  | .bStaff => some .b
  | _ => none

end Domain
