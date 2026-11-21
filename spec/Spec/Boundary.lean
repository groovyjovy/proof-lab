/- 共有境界の操作で照合する版。座標と覆い方の判定は PostGIS に置く。 -/
namespace App

structure BoundaryEdit where
  neighborId : Nat
  neighborVersion : Nat
  position : Nat
  verifiedVersion : Option Nat := none
  draft : Option Nat := none
  deriving DecidableEq, Repr

def BoundaryEdit.verify (b : BoundaryEdit) (id : Nat) (version : Option Nat) : BoundaryEdit :=
  if id ≠ b.neighborId then b
  else if version = some b.neighborVersion then { b with verifiedVersion := version }
  else { b with verifiedVersion := none, draft := none }

def BoundaryEdit.verified (b : BoundaryEdit) : Prop :=
  b.verifiedVersion = some b.neighborVersion

instance (b : BoundaryEdit) : Decidable b.verified := by
  unfold BoundaryEdit.verified
  infer_instance

def BoundaryEdit.move (b : BoundaryEdit) (position : Nat) : BoundaryEdit :=
  if b.verified ∧ position < 3 then
    { b with draft := if position = b.position then none else some position }
  else b

theorem boundary_wrong_version_clears_draft (b : BoundaryEdit) {version : Option Nat}
    (h : version ≠ some b.neighborVersion) :
    (b.verify b.neighborId version).draft = none := by
  simp [BoundaryEdit.verify, h]

theorem boundary_move_requires_verified_version (b : BoundaryEdit) (position : Nat)
    (h : (b.move position).draft ≠ b.draft) : b.verified := by
  by_cases hv : b.verified
  · exact hv
  · exact (h (by simp [BoundaryEdit.move, hv])).elim

/-- One publication raises both row versions, even if earlier attribute edits changed only one row. -/
def BoundaryEdit.commitVersions (actual expected : Nat × Nat) : Option (Nat × Nat) :=
  if actual = expected then
    let next := max actual.1 actual.2 + 1
    some (next, next)
  else none

theorem boundary_commit_versions {actual expected next : Nat × Nat}
    (h : BoundaryEdit.commitVersions actual expected = some next) :
    actual = expected ∧ next.1 = next.2 ∧ actual.1 < next.1 ∧ actual.2 < next.2 := by
  unfold BoundaryEdit.commitVersions at h
  split at h
  · rename_i hactual
    simp at h
    subst next
    exact ⟨hactual, rfl,
      Nat.lt_succ_of_le (Nat.le_max_left _ _), Nat.lt_succ_of_le (Nat.le_max_right _ _)⟩
  · contradiction

end App
