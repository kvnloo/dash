# O15 dash-release: no green tester army, no release

Owner rule (2026-10-27): Dash is never installed on a phone, promoted, sent
over a channel/OTA, or merged into main/nightly/dev/an integration branch
without a full e2e tester-army pass for that exact commit.

```
release.bend   the decision: release_allows(build_sha, receipt) and gate(action, ...)
LAWS.bend      10 claims L1-L7 (the owner's spec; do not weaken to pass)
PROOF.bend     proofs (hand-written; no generator)
mutations.py   20 broken variants of release.bend; each must make PROOF.bend fail
mutations.json the last mutation run
receipt.json   `hermes bend verify` receipt
check.py       the gate every release path calls; mirrors release.bend
test_check.py  parity with the Bend book + evidence rules
```

## Who calls the gate

| path | call |
| --- | --- |
| test suite | `bun run test` = `scripts/army.sh` (army, then the receipt) |
| PR / merge | `.github/workflows/ci.yml` job `test (tester army + O15 gate)`: army on the PR head, receipt artifact `army-receipt-<sha>`, then `check.py --action merge` |
| APK build | `scripts/build-native-android.sh`: `check.py --action install` before any install, build or signing |
| phone install | `scripts/phone-install.sh`: `check.py --action install` before `adb install` |
| preview -> nightly | `.github/workflows/promote-preview.yml`: `check.py --action promote` on the preview tip |

## The receipt

The army runners (`scripts/army.sh` headless on any host or CI;
`e2e/mbp-army/run.py` headed on the MBP private display) call
`e2e/mbp-army/receipt.py` after Playwright exits. It writes
`<store>/<sha>/receipt.json` plus the run's Playwright report
`results.json`:

```json
{"schema": "dash-army-receipt/1", "sha": "<40-hex>", "dirty": false,
 "all_pass": true, "coverage": "complete",
 "counts": {"tests": 16, "failed": 0, "skipped": 0, "skipped_without_reason": 0},
 "features": {"pairing": 1, "...": 1},
 "runner": {"name": "dash-tester-army", "path": "e2e/mbp-army", "digest": "<sha256>"},
 "run_dir": "...", "report": "results.json", "report_sha256": "<sha256>"}
```

`check.py` never trusts the receipt's own verdict. It re-reads the report,
checks its hash, recomputes failures, unexplained skips and per-feature passes
against `e2e/mbp-army/features.json` from the checkout being released, and
requires the runner digest to equal that checkout's `e2e/mbp-army`. A receipt
from another harness, an edited army, a dirty tree, another commit, a red or
partial run is denied.

Canonical location: the CI artifact `army-receipt-<sha>` on kvnloo/dash (written
only by the CI army job, readable from every host with `gh`; `check.py --fetch`
downloads it). Local runs also write to `$DASH_ARMY_RECEIPTS`
(default `~/.local/state/dash/army-receipts`), and fleet build snapshots may carry
`.native-build-inputs/army-receipts/<sha>/`. The same checker reads all three.

## Proof

Same method as the ops plane (O1-O13): MBP fleet queue with the Bend toolchain
staged as a job input, `BEND` set to the job's checker. From the repository root:

```bash
(cd laws/release && "$BEND" PROOF.bend --verdict)
python3 laws/release/mutations.py --verdict --out laws/release/mutations.json
python3 -m unittest laws/release/test_check.py -v
```

Require `ALL PROOFS CHECK`, a passing unmodified reference, **20/20 mutants
rejected** (a mutant that does not parse counts as N/A, never as rejected), and
both parity tests passed (not skipped). `receipt.json` comes from
`hermes -p clean bend verify laws/release --receipt laws/release/receipt.json`.

| law | claim (Bend name) |
| --- | --- |
| L1 | `o15_no_receipt_denies` |
| L2 | `o15_red_denies` |
| L3 | `o15_other_sha_denies` |
| L4 | `o15_incomplete_denies`, `o15_empty_inventory_incomplete`, `o15_unexplained_skip_incomplete`, `o15_uncovered_feature_incomplete` |
| L5 | `o15_adhoc_denies` |
| L6 | `o15_one_gate` |
| L7 | `o15_green_allows` (not vacuous) |

Scope: the laws are theorems about release.bend. Parity measures that check.py
computes the same function; the evidence tests cover how check.py reads real
files. A PASS is never an authorization by itself.
