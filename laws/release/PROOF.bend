# O15 dash-release: the proofs of LAWS.bend (hand-written; no generator).

import Base
import ./release.bend as R
import ./LAWS.bend as Laws

# Proof kit (same lemmas as the ops plane)
# ----------------------------------------

def and_l(+a: Bool, -b: Bool, w: Laws.T(Bool.and(a, b))) -> Laws.T(a):
  match a:
    case True{}:
      Unit{}
    case False{}:
      Empty.absurd(Laws.T(False{}), w)

def and_r(a: Bool, -b: Bool, w: Laws.T(Bool.and(a, b))) -> Laws.T(b):
  match a:
    case True{}:
      w
    case False{}:
      Empty.absurd(Laws.T(b), w)

def and_i(a: Bool, -b: Bool, ta: Laws.T(a), tb: Laws.T(b)) -> Laws.T(Bool.and(a, b)):
  match a:
    case True{}:
      tb
    case False{}:
      Empty.absurd(Laws.T(Bool.and(False{}, b)), ta)

def eq_sound(a: Nat, b: Nat, w: Laws.T(Nat.is_eq(a, b))) -> {a == b : Nat}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+q:
      Empty.absurd({0n == 1n+q : Nat}, w)
    case 1n+p 0n:
      Empty.absurd({1n+p == 0n : Nat}, w)
    case 1n+p 1n+q:
      %eq_sound(p, q, w) : {1n+p == 1n+_ : Nat}
      {==}

def eq_refl(n: Nat) -> Laws.T(Nat.is_eq(n, n)):
  match n:
    case 0n:
      Unit{}
    case 1n+p:
      eq_refl(p)

# What an allowed receipt carries (one lemma per conjunct of r_ok)
# ----------------------------------------------------------------

def ok_sha(+build: Nat, +sha: Nat, -failed: Nat, -fs: List<&2, Nat>, -skips: Nat, -army: Bool, w: Laws.T(R.r_ok(build, sha, failed, fs, skips, army))) -> {build == sha : Nat}:
  eq_sound(build, sha, and_l(Nat.is_eq(build, sha), Bool.and(Nat.is_eq(failed, 0n), Bool.and(R.cov_complete(fs, skips), army)), w))

def ok_failed(+build: Nat, +sha: Nat, +failed: Nat, -fs: List<&2, Nat>, -skips: Nat, -army: Bool, w: Laws.T(R.r_ok(build, sha, failed, fs, skips, army))) -> {failed == 0n : Nat}:
  +rest = and_r(Nat.is_eq(build, sha), Bool.and(Nat.is_eq(failed, 0n), Bool.and(R.cov_complete(fs, skips), army)), w)
  eq_sound(failed, 0n, and_l(Nat.is_eq(failed, 0n), Bool.and(R.cov_complete(fs, skips), army), rest))

def ok_cov(+build: Nat, +sha: Nat, +failed: Nat, +fs: List<&2, Nat>, +skips: Nat, -army: Bool, w: Laws.T(R.r_ok(build, sha, failed, fs, skips, army))) -> Laws.T(R.cov_complete(fs, skips)):
  +r1 = and_r(Nat.is_eq(build, sha), Bool.and(Nat.is_eq(failed, 0n), Bool.and(R.cov_complete(fs, skips), army)), w)
  +r2 = and_r(Nat.is_eq(failed, 0n), Bool.and(R.cov_complete(fs, skips), army), r1)
  and_l(R.cov_complete(fs, skips), army, r2)

def ok_army(+build: Nat, +sha: Nat, +failed: Nat, +fs: List<&2, Nat>, +skips: Nat, w: Laws.T(R.r_ok(build, sha, failed, fs, skips, False{}))) -> Empty:
  +r1 = and_r(Nat.is_eq(build, sha), Bool.and(Nat.is_eq(failed, 0n), Bool.and(R.cov_complete(fs, skips), False{})), w)
  +r2 = and_r(Nat.is_eq(failed, 0n), Bool.and(R.cov_complete(fs, skips), False{}), r1)
  and_r(R.cov_complete(fs, skips), False{}, r2)

# L1
def Laws.o15_no_receipt_denies(a, build):
  match a:
    case R.RInstall{}:
      {==}
    case R.RPromote{}:
      {==}
    case R.ROta{}:
      {==}
    case R.RMerge{}:
      {==}

# L2
def Laws.o15_red_denies(a, build, sha, failed, fs, skips, army, w):
  match a:
    case R.RInstall{}:
      ok_failed(build, sha, failed, fs, skips, army, w)
    case R.RPromote{}:
      ok_failed(build, sha, failed, fs, skips, army, w)
    case R.ROta{}:
      ok_failed(build, sha, failed, fs, skips, army, w)
    case R.RMerge{}:
      ok_failed(build, sha, failed, fs, skips, army, w)

# L3
def Laws.o15_other_sha_denies(a, build, sha, failed, fs, skips, army, w):
  match a:
    case R.RInstall{}:
      ok_sha(build, sha, failed, fs, skips, army, w)
    case R.RPromote{}:
      ok_sha(build, sha, failed, fs, skips, army, w)
    case R.ROta{}:
      ok_sha(build, sha, failed, fs, skips, army, w)
    case R.RMerge{}:
      ok_sha(build, sha, failed, fs, skips, army, w)

# L4
def Laws.o15_incomplete_denies(a, build, sha, failed, fs, skips, army, w):
  match a:
    case R.RInstall{}:
      ok_cov(build, sha, failed, fs, skips, army, w)
    case R.RPromote{}:
      ok_cov(build, sha, failed, fs, skips, army, w)
    case R.ROta{}:
      ok_cov(build, sha, failed, fs, skips, army, w)
    case R.RMerge{}:
      ok_cov(build, sha, failed, fs, skips, army, w)

# L4a
def Laws.o15_empty_inventory_incomplete(skips, w):
  w

# L4b
def Laws.o15_unexplained_skip_incomplete(fs, n, w):
  match fs:
    case Nil{}:
      w
    case +h <> +t:
      and_l(Nat.is_eq(1n+n, 0n), Bool.and(Nat.is_gt(h, 0n), R.all_pos(t)), w)

# L4c: by induction over the inventory
def head_nz(h: Nat, +t: List<&2, Nat>, ok: Laws.T(Bool.and(Nat.is_gt(h, 0n), R.all_pos(t))), z: Laws.T(Bool.or(Nat.is_eq(h, 0n), Laws.has_zero(t))), rec: Laws.T(R.all_pos(t)) -> Laws.T(Laws.has_zero(t)) -> Empty) -> Empty:
  match h:
    case 0n:
      and_l(Nat.is_gt(0n, 0n), R.all_pos(t), ok)
    case 1n+p:
      rec(and_r(Nat.is_gt(1n+p, 0n), R.all_pos(t), ok), z)

def ap_nz(fs: List<&2, Nat>, ok: Laws.T(R.all_pos(fs)), z: Laws.T(Laws.has_zero(fs))) -> Empty:
  match fs:
    case Nil{}:
      z
    case +h <> +t:
      head_nz(h, t, ok, z, x => y => ap_nz(t, x, y))

def Laws.o15_uncovered_feature_incomplete(fs, skips, ok, z):
  match fs:
    case Nil{}:
      ok
    case +h <> +t:
      head_nz(h, t, and_r(Nat.is_eq(skips, 0n), Bool.and(Nat.is_gt(h, 0n), R.all_pos(t)), ok), z, x => y => ap_nz(t, x, y))

# L5
def Laws.o15_adhoc_denies(a, build, sha, failed, fs, skips, w):
  match a:
    case R.RInstall{}:
      ok_army(build, sha, failed, fs, skips, w)
    case R.RPromote{}:
      ok_army(build, sha, failed, fs, skips, w)
    case R.ROta{}:
      ok_army(build, sha, failed, fs, skips, w)
    case R.RMerge{}:
      ok_army(build, sha, failed, fs, skips, w)

# L6
def Laws.o15_one_gate(a, build, r):
  match a:
    case R.RInstall{}:
      {==}
    case R.RPromote{}:
      {==}
    case R.ROta{}:
      {==}
    case R.RMerge{}:
      {==}

# L7
def green(+build: Nat, n: Nat) -> Laws.T(R.release_allows(build, R.RFound{build, 0n, [1n+n], 0n, True{}})):
  and_i(Nat.is_eq(build, build), Bool.and(Nat.is_eq(0n, 0n), Bool.and(R.cov_complete([1n+n], 0n), True{})), eq_refl(build), Unit{})

def Laws.o15_green_allows(a, build, n):
  match a:
    case R.RInstall{}:
      green(build, n)
    case R.RPromote{}:
      green(build, n)
    case R.ROta{}:
      green(build, n)
    case R.RMerge{}:
      green(build, n)
