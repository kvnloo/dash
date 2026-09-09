GOAL         Collapsed pager gold follows the Main page and paints sRGB fallbacks on Android.
SCOPE        AppNav*, golden-nav.ts, nav assets, docs/design/nav-probe.html. Worktree `.worktrees/nav` branch `svc/nav`.
CONTEXT      .cursor/skills/verify-dash/features/nav.md. Landed 1ef1323.
ACCEPTANCE   bun test app/src/components/golden-nav.test.ts passes; Main passes tab into AppNav
VERIFY       bun scripts/verify-dash/control-dash.ts test
TIMEBOX      done
FORBIDDEN    no pairing, no bridge
REPORT       1ef1323 on svc/nav and integrate/device-layer
STANDING     orchestrate/dash/preferences.md
