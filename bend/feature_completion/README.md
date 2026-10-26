# Feature completion law

When may a Dash ledger feature (`spec/features.yaml`) be called **Done**, and when may an
autonomous run **stop**? `MODEL.bend` is the decision; `scripts/feature_status.py` is its
Python twin, checked case by case against it.

- **Done** needs four things: the feature is linked in the spec, the code is present, a
  real-device journey passed on the exact candidate sha (`JPassCandidate`), and the owner
  preview was delivered (`PDelivered`). A pass on another sha is stale and does not count.
  Unit tests alone do not count.
- **Blocked** needs an explicit blocker with a reason (`BOwner` or `BExternal`). A blocker
  without a reason (`BNoReason`) is treated as no blocker.
- Anything else is **Open**.
- **may_stop**: the run stops only when the owner stops it or every in-scope feature is
  Done or Blocked. Budget exhaustion alone gives `RPauseReport`, never a stop.

Boundary: nothing here proves that a receipt is authentic or that a device or sha is real.
The CLI fails closed: it ignores any receipt it cannot classify. A proof is not permission
(`proof_is_permission=false`).

```bash
export BEND=$HOME/.bend/bin/bend LEAN_BIN=$HOME/.elan/toolchains/leanprover--lean4---v4.34.0/bin
(cd bend/feature_completion && $BEND PROOF.bend --verdict)   # ALL PROOFS CHECK
python3 -I tests/feature_completion_parity.py                # 136 cases match
python3 -I tests/feature_completion_mutation.py              # every mutant rejected
python3 scripts/feature_status.py --evidence DIR --scope P0  # exit 1 unless the run may stop
```

Toolchain pins: `toolchain.json` (Bend 2.0.34, Lean 4.34.0), enforced by `tests/bend_verifier.py`.
