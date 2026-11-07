# O15 dash-release: may this exact Dash commit ship?
#
# Owner rule (2026-10-27): Dash is never installed on a phone, promoted, sent
# over a channel/OTA, or merged into main/nightly/dev/integration without a
# full e2e tester-army pass for that exact commit.
#
# laws/release/check.py turns real evidence (the receipt the army runner wrote,
# its Playwright report and the feature inventory) into these inputs and calls a
# line-for-line mirror of release_allows. A PASS is never an authorization by
# itself; the scripts and CI that call check.py are the gates.
#
# Constructor names are global in Bend, so every one here carries an R prefix.

import Base

# What is being released.
type RAct is Data:
  RInstall{}
  RPromote{}
  ROta{}
  RMerge{}

# What check.py found for the build commit.
#   sha     the commit the receipt names (the build commit is `build`)
#   failed  tests that did not pass (unexpected, flaky, timed out, interrupted)
#   feats   one entry per inventoried feature: how many of its tests passed
#   skips   tests skipped without a written reason
#   army    the receipt came from the army runner at this commit (runner digest
#           matches and the report hash matches); false for any other harness
type RRec is Data:
  RNone{}
  RFound{sha: Nat, failed: Nat, feats: List<&2, Nat>, skips: Nat, army: Bool}

# Every listed feature has at least one passing test.
def all_pos(fs: List<&2, Nat>) -> Bool:
  match fs:
    case Nil{}:
      True{}
    case h <> t:
      Bool.and(Nat.is_gt(h, 0n), all_pos(t))

# Coverage is complete: the inventory is not empty, nothing was skipped without
# a reason, and every inventoried feature has a passing test.
def cov_complete(fs: List<&2, Nat>, skips: Nat) -> Bool:
  match fs:
    case Nil{}:
      False{}
    case h <> t:
      Bool.and(Nat.is_eq(skips, 0n), Bool.and(Nat.is_gt(h, 0n), all_pos(t)))

def r_ok(build: Nat, sha: Nat, failed: Nat, fs: List<&2, Nat>, skips: Nat, army: Bool) -> Bool:
  Bool.and(Nat.is_eq(build, sha), Bool.and(Nat.is_eq(failed, 0n), Bool.and(cov_complete(fs, skips), army)))

def release_allows(build: Nat, r: RRec) -> Bool:
  match r:
    case RNone{}:
      False{}
    case RFound{sha, failed, feats, skips, army}:
      r_ok(build, sha, failed, feats, skips, army)

# Every release path asks the same question.
def gate(a: RAct, build: Nat, r: RRec) -> Bool:
  match a:
    case RInstall{}:
      release_allows(build, r)
    case RPromote{}:
      release_allows(build, r)
    case ROta{}:
      release_allows(build, r)
    case RMerge{}:
      release_allows(build, r)
