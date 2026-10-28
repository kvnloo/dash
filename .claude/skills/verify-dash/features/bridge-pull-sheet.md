# Bridge pull-down sheet

A chevron in the top nav ("Bridge details") pulls down a sheet that shows whether the bridge is connected, the list of Hosts, one chip per harness on the connected host ("Harnesses on <host>"), and an Edit bridge button that opens Settings. Tapping a harness chip starts a new chat of that harness.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-00-01-navigation-shell-top-nav-and-bridge-p.spec.ts` › "chevron opens the sheet rotated 180 degrees; Dismiss closes it"; "sheet shows connection status, Hosts and every harness on the host"; "New <harness> in the sheet creates that harness chat and opens Chat"; "Edit bridge (paired) opens Settings"

## Sub-features

- `sheet-open-close` the chevron opens the sheet and flips 180 degrees, and the dim area closes it. [UNCOVERED]
- `sheet-status-hosts` shows connection status, `Hosts` and the `this laptop` row. [UNCOVERED]
- `sheet-harnesses` shows `Harnesses on <host>` with `New OMP chat`, `New Hermes chat` and `<name>, not installed` chips. [UNCOVERED]
- `sheet-new-harness-chat` a chip creates a chat of that harness and opens Chat. [UNCOVERED]
- `sheet-edit-bridge` Edit bridge opens Settings. [UNCOVERED]

## How to get to it (user POV)

- Tap the chevron at the right end of the top nav.
- On a phone, pull the nav down (native gesture only).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired, on Main (any tab). The fixture bridge reports OMP and Hermes.

- **Open the sheet.** `await page.getByRole('button',{name:'Bridge details',exact:true}).click()`. `Dismiss bridge details` and `Edit bridge` buttons appear.
- **Read it.** `await expect(page.getByText(/^Harnesses on /)).toBeVisible()`, `page.getByText('Hosts',{exact:true})`, `page.getByRole('button',{name:'New Hermes chat',exact:true})`.
- **New chat from a chip.** Click `New Hermes chat`. The chat composer (`composer(page)`) is visible with a placeholder containing `Hermes`, and the sheet is gone.
- **Edit bridge.** Click `getByRole('button',{name:'Edit bridge',exact:true})`. Heading `Settings` appears.
- **Close.** Click `getByRole('button',{name:'Dismiss bridge details',exact:true})` near its bottom edge (position `y = height - 24`) so the click lands on the dim area, not the sheet. Both buttons disappear.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/bridge-pull.spec.ts`), then `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The screenshot must show the open sheet with status, Hosts and chips; `bridge.log` must show the chat the chip created.

## Gotchas

- Two controls share the name `Bridge details` in source (nav chevron and the sheet toggle). Scope or use `.first()` if Playwright reports a strict-mode violation.
- The dismiss layer covers the sheet's own area. Click its lower edge, not its center.
- The host name in `Harnesses on <host>` is the machine name, so read it from the page. Never hard-code it.
- Pulling the nav down by dragging is not attached on web; only the chevron works.
