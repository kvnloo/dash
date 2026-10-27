# Target switcher

A badge in the chat window is meant to open a "Switch target" sheet that lists the available hosts, harnesses, profiles, sessions and models, with a close X. At this build the component exists but nothing mounts it, so users cannot reach it.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-02-03-chat-screen-chrome-header-full-screen.spec.ts` › "03.19 target switcher badge opens the switcher and its close X closes it"

## Sub-features

- `target-badge` `target-switcher-badge` is visible in the chat window. [UNCOVERED] Not mounted.
- `target-open` tapping it opens `Switch target` with the available-targets list. [UNCOVERED]
- `target-close` the close X closes it. [UNCOVERED]

## How to get to it (user POV)

- Intended: open a chat window and tap the target badge. Not reachable yet.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `openChat(page, bridge)` for a windowed chat.

- **Find the badge.** `await expect(page.getByTestId('target-switcher-badge')).toBeVisible()`.
- **Open it.** Click the badge. `getByRole('heading',{name:'Switch target',exact:true})` and `getByLabel('Available hosts, harnesses, profiles, sessions and models')` are visible.
- **Close it.** `await page.getByTestId('target-switcher-close').click({noWaitAfter:true})`. The heading has count 0.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/target-switcher.spec.ts`), then `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Once mounted, the screenshot must show the open switcher inside the viewport.

## Gotchas

- Expected FAIL at 2c948dc: `TargetSwitcherBadge.tsx` and `target-switcher.ts` hold `target-switcher-badge`, `target-switcher-close` and `Switch target`, but no file imports the component. The first assertion fails with "not mounted".
- Report this as a failing journey with that reason. Do not weaken it.
- Identity (`identity-badge.md`) is a different badge and is mounted.
