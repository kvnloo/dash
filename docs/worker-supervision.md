# Read-only worker supervision

GET /supervision requires the paired bridge execution token in an Authorization
Bearer header, and inherits bridge/index.ts host/origin admission. No URL-token
fallback. POST and other methods return 405. The response is { needs_kevin,
state }; cache-control is no-store. Missing, corrupt, or mixed-generation files
return 503, never an invented empty queue. This handler only reads two fixed
files and cannot record decisions or execute workers.

Default source:
/mnt/zer0models/workspace/zer0/data/operations/fsm/live/{state,needs-kevin}.json

Override with DASH_SUPERVISION_DIR on the supervision host if needed. The files
come from the z0intelligence supervision timer, not the Dash approval outbox.
The Approvals screen adds a pull-only Needs Kevin section grouped by
recommended decision, with why, options and a selectable evidence path.
Updates only while the app is active; there are no notifications or worker
controls. Old snapshots are labeled stale after 20 minutes. The batch does not
block dispatch. Record owner dispositions in the host's worker-decisions.jsonl;
the next supervision tick clears the corresponding items.

Deployment is intentionally NOT activated by this change. The owner must
integrate the draft and restart dash-bridge-4747 / dash-metro-8097 at a suitable
time. Do not change the active services' worktree just to preview this branch.
The supervision timer itself is already usable independently of Dash.

Verification from this change:
- New route/parser tests: four passed, including a real isolated HTTP server.
- MBP via fleet-build: bridge typecheck passed; app typecheck passed.
- bun test bridge/src: 233 pass, 1 fail, 2 errors. Unchanged integration base:
  229 pass, 1 fail, 2 errors, same Cannot call describe() after the test run has
  completed in hermes-stream.test.ts. No unrelated test-runner fix included.
- Run each bridge/src/*.test.ts and bridge/src/*/*.test.ts in a fresh Bun
  process: all 31 files, 252 tests passed on MBP. This avoids the existing
  cross-file runner contamination; it does not erase the combined-suite failure.
- The MBP cannot authenticate its private aodl-views git dependency. App checking
  used an isolated staging copy with that package's exact pinned revision
  7bbe46909b4e76557cd2d87c3f5be7b9f957eaec fetched through the configured GitHub
  integration and installed as a local package. No credentials were copied.
  No repository manifest or lockfile changed. Other semver dependencies in that
  staging install were re-resolved; a fully frozen app install remains blocked
  on the MBP's git auth. No phone or active Dash service was touched.
- No device/pixel verification is claimed. Owner integration/restart remains
  deliberately deferred.
