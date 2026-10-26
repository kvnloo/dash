# Native device journeys (S22+, exact-SHA receipts)

One journey function per spec journey id in `spec/features.yaml` (51 of 51, so every P0 and P1
feature has one). Each journey drives Dash like a user, asserts what a user can observe, takes
screenshots, and writes one receipt per feature that `scripts/feature_status.py` reads.

This harness was copied from the S22 journey harness and adapted. Behaviour that was kept:
- The target is the S22+ agent phone (`RFCTA1RZAQY`, adb `S22_SERIAL`). A model in the S25 family is refused.
- The app is the real dev-client APK. Its JS comes from an isolated Metro on the MBP (`:18520`), and the
  bridge is isolated on the MBP tailnet IP (`:18530`) with deterministic ACP fixture agents. The live bridge is never used.
- `/tmp/s22-ui.lock` is held for the whole run. The ChatGPT driver uses the same rule: one UI user per device.
- The owner-activity guard, ported from `fleet-adb restore_guest`, runs before every journey. A
  verdict of `owner_busy`, `in_call` or `owner_evidence_unavailable` writes a skip receipt and stops the run (exit 3).
- Every launch is recorded in `/tmp/s22-agent-opened.json`. After a physical run, the phone goes back to the ChatGPT lane.

```
ssh mbp bash ~/dash-e2e-army-20261025/start-device-stack.sh <sha>       # or: --start-stack
uv run -q --with uiautomator2 python e2e/device/run_journeys.py --sha <sha> --all --display virtual --seed-archive 300
uv run -q --with uiautomator2 python e2e/device/run_journeys.py --sha <sha> --features DF-001,DF-002,DF-035,DF-086
python3 e2e/device/run_journeys.py --dry-run --all          # no device: linkage + plan
bun run spec:e2e                                            # linkage unit tests + dry run
bun run spec:status -- --candidate <sha> --scope P0         # read the receipts
```

## Files

| File | Role |
|---|---|
| `run_journeys.py` | CLI: selection, capabilities, lock, seeding, receipts root, `summary.json` |
| `journeys.py` | The 51 journey functions and the user-level helpers (tabs, rows, composer, search, scroll, frames) |
| `framework.py` | Registry, `Ctx.check`, the per-feature pass rule and the receipt writer |
| `device.py` | adb, uiautomator2, physical and virtual display, owner guard, `gfxinfo framestats`, PSS |
| `seed_archive.py` | Seeds archived Codex, Claude Code, Grok and OMP sessions into the isolated bridge HOME. It refuses a real HOME. |
| `start-device-stack.sh`, `device-bridge.ts` | Isolated candidate stack on the MBP (copied; `DASH_E2E_BASE` and `ARMY_DIR` can be overridden) |
| `probe.py` | Taps and types, then dumps the tree and a screenshot (guarded, locked) |
| `SURFACES.md` | Mapping from the earlier surface to a journey (copied) |

## Receipts

`<out>/<journey>/<feature>.json` (default `.acceptance-receipts/<sha12>-<UTC>/`) contains:
`feature_id, journey_id, candidate_sha, device_serial, display, started_at, finished_at, result,
evidence[], failure_reason, metrics, checks[]`, and the CLI fields `kind, feature, journey, sha, real_device, device`.

- A feature passes only when all untagged checks pass and all checks tagged with that feature pass.
  When the journey tags any check, at least one tagged check for the feature must have run.
- A crash, or a required step that fails, makes the receipt a fail with the reason.
- `kind: "journey-partial"` means the run lacked an environment capability. The CLI ignores this
  kind, so a partial run can never make a feature Done, but its checks and metrics stay as evidence.
- `kind: "journey-skip"` means the owner guard stopped the run.

## Capabilities

The journey declares a capability with `needs=`. Each one has its own switch:

| Capability | Switch |
|---|---|
| `second_host` | `DASH_E2E_SECOND_HOST` |
| `real_agent` | `DASH_E2E_REAL_AGENT=1`, a candidate bridge with a real Hermes/OMP |
| `archive_seed` | `--seed-archive N` |
| `physical_display` | `--display physical` |
| `spen` | detected with `pm list features` |
| `host_reboot`, `turbo`, `z0live`, `watch_agent` | `DASH_E2E_*=1` |
| `repo_checks` | the runner checkout is at `--sha` |

## In-flight chat feature (DF-001, DF-002, DF-035, DF-086)

- `J-chat-list-all-harnesses`: a cold open, then Chats is scrolled to the end. It requires 1000 or more distinct `chat-row-*`, rows
  for every harness (Codex, Claude Code, Grok, OMP, Hermes, and for DF-009 pi and fx), seeded archive rows,
  live rows marked `Live on host`, and scroll frames within budget.
- `J-chat-search-fast`: `@chats <token>` in the Main composer, searching by title and by message body.
  The first result must appear in under 1 s (the spec target is 200 ms; UI polling resolves about 0.3 s, so 1 s is the pass bar).
  Tapping the result must open that exact session.
- `J-chat-open-history`: live Hermes and OMP transcripts render and continue the same session. An archived Codex chat
  opens at turn 119, and paging back reaches its oldest-turn token, with the paging frames measured.
- `J-perf-profile`: list, transcript, detail and orb frame budgets, PSS growth over 60 s idle, and no
  frames while the app is backgrounded.

The budgets are constants at the top of `journeys.py`. `DASH_E2E_JANK_PCT_MAX` and `DASH_E2E_P95_MS_MAX` override them.
Frame time is `FrameCompleted - IntendedVsync` for frames with `Flags == 0`, measured against the panel refresh rate.
A dev-client bundle is pessimistic, so confirm a frame regression on a release bundle before you attribute it.

## Not yet proven on a device

No journey was run on a device while this harness was written. Before the first virtual run, check these:
- `--display virtual` needs `scrcpy >= 3.0` on groot (`--new-display`). It is not installed there now.
- uiautomator2 must report nodes from the secondary display. The harness filters on `display-id` when that attribute exists.
- `screencap -d <id>` must capture the virtual display.

The Grok archive layout in `seed_archive.py` is an assumption. At cfc08de the bridge lists none of the seeded archives,
and those journeys exist to catch exactly that.
