# O15 dash-release: the laws. The owner states them (2026-10-27); PROOF.bend
# proves them; `bend PROOF.bend --verdict` (or `hermes bend verify`) checks.
# Do not weaken a law to get a PASS.
#
# Scope: theorems about release.bend's decision function over abstract inputs.
# That check.py mirrors it is measured by laws/release/test_check.py (parity);
# that check.py reads the evidence faithfully is that file's job, not a proof.

import Base
import ./release.bend as R

# Boolean reflection: T(b) is Unit when b holds, Empty when it does not
def T(b: Bool) -> Data:
  match b:
    case True{}:
      Unit
    case False{}:
      Empty

# Written apart from release.bend: some inventoried feature has no passing test.
def has_zero(fs: List<&2, Nat>) -> Bool:
  match fs:
    case Nil{}:
      False{}
    case h <> t:
      Bool.or(Nat.is_eq(h, 0n), has_zero(t))

# L1. No receipt: every release path is denied.
law o15_no_receipt_denies:
  for a: R.RAct
  for build: Nat
  {R.gate(a, build, R.RNone{}) == False{} : Bool}

# L2. Red army: allowed implies zero failed tests.
law o15_red_denies:
  for a: R.RAct
  for build: Nat
  for sha: Nat
  for failed: Nat
  for fs: List<&2, Nat>
  for skips: Nat
  for army: Bool
  for w: T(R.gate(a, build, R.RFound{sha, failed, fs, skips, army}))
  {failed == 0n : Nat}

# L3. Other commit: allowed implies the receipt names exactly the build commit.
law o15_other_sha_denies:
  for a: R.RAct
  for build: Nat
  for sha: Nat
  for failed: Nat
  for fs: List<&2, Nat>
  for skips: Nat
  for army: Bool
  for w: T(R.gate(a, build, R.RFound{sha, failed, fs, skips, army}))
  {build == sha : Nat}

# L4. Incomplete coverage: allowed implies complete coverage ...
law o15_incomplete_denies:
  for a: R.RAct
  for build: Nat
  for sha: Nat
  for failed: Nat
  for fs: List<&2, Nat>
  for skips: Nat
  for army: Bool
  for w: T(R.gate(a, build, R.RFound{sha, failed, fs, skips, army}))
  T(R.cov_complete(fs, skips))

# ... and complete coverage means what the owner said:
# L4a. an empty feature inventory is never complete
law o15_empty_inventory_incomplete:
  for skips: Nat
  for w: T(R.cov_complete([], skips))
  Empty

# L4b. any test skipped without a reason makes coverage incomplete
law o15_unexplained_skip_incomplete:
  for fs: List<&2, Nat>
  for n: Nat
  for w: T(R.cov_complete(fs, 1n+n))
  Empty

# L4c. any inventoried feature with no passing test makes coverage incomplete
law o15_uncovered_feature_incomplete:
  for fs: List<&2, Nat>
  for skips: Nat
  for ok: T(R.cov_complete(fs, skips))
  for z: T(has_zero(fs))
  Empty

# L5. Ad-hoc harness results never count: allowed implies the army runner wrote it.
law o15_adhoc_denies:
  for a: R.RAct
  for build: Nat
  for sha: Nat
  for failed: Nat
  for fs: List<&2, Nat>
  for skips: Nat
  for w: T(R.gate(a, build, R.RFound{sha, failed, fs, skips, False{}}))
  Empty

# L6. One gate: install, promotion, channel/OTA and merge ask the same question.
law o15_one_gate:
  for a: R.RAct
  for build: Nat
  for r: R.RRec
  {R.gate(a, build, r) == R.release_allows(build, r) : Bool}

# L7. Not vacuous: a green, complete army receipt for this commit allows release.
law o15_green_allows:
  for a: R.RAct
  for build: Nat
  for n: Nat
  T(R.gate(a, build, R.RFound{build, 0n, [1n+n], 0n, True{}}))
