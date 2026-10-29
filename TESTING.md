# Testing Dash

**The test suite is the e2e tester army** (`e2e/mbp-army`): the real Expo web
app, an authenticated real Bun bridge per test, and a deterministic ACP fixture
agent. No route mocks, no store seeding, no phone, no live services.

```bash
bun run test            # = scripts/army.sh: web export -> army -> O15 receipt for HEAD
```

Needs bun, node, `bwrap` with unprivileged user namespaces, and Playwright
Chromium (`node node_modules/playwright/cli.js install chromium`). Runs headless
on any host and in CI. The MBP headed variant on a private headless compositor
is `python3 e2e/mbp-army/run.py <name> <workers>` (see `e2e/mbp-army/README.md`).

## Session filters and sort

`e2e/mbp-army/chat-filters.spec.ts` covers the combined harness, exact project,
local-date, pagination and visual-sort controls. The Active session journey
uses two isolated hosts with the same native session ID. It checks membership
under Recent, Oldest and Priority, then removes an offline host.

Active means a current host-scoped running or open session, or a phone turn
in progress. It includes an idle session held in a host TUI. Saved history
alone does not qualify. Active does not scan archive pages. Switching back
to All sessions preserves access to saved history.

The combined journey also crosses successive history pages. A completed page
must release its single-flight entry before notifying subscribers, so a filter
scan can request the next page without stalling.

Run the complete suite on the integrated commit before RC3 merge. A filtered
feature run is not a complete release receipt or native phone acceptance.

## Release law O15

No green, complete army receipt for the exact commit means no APK, no phone
install, no channel/OTA promotion and no merge. Law, proof and checker:
`laws/release/` (README there). Every army run writes the receipt;
`laws/release/check.py` is the only gate, called by CI, `scripts/build-native-android.sh`,
`scripts/phone-install.sh` and `.github/workflows/promote-preview.yml`.

Coverage is complete when every feature in `e2e/mbp-army/features.json` has a
passing army test and nothing was skipped without a reason. Add a feature
together with its army test. Never remove a feature or a test to get a pass.

## Other gates

| gate | command |
| --- | --- |
| O15 checker | `python3 -m unittest laws/release/test_check.py` (evidence rules; parity with the Bend book where Bend is installed) |
| typecheck / lint | `bun run typecheck`; `bun run lint` |

There is no unit-test suite and no mutation gate: the army is the suite.

Web army evidence is not native phone acceptance: native IME, voice, Android
permissions and live model behaviour are not covered yet
(`not_yet_in_army` in `features.json`). Never report a test, screenshot or phone
check as passed unless it ran against that exact commit.
