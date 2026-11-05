# Paired bridges and Forget this bridge

Paired Settings lists every paired bridge in failover order and marks the active one "(in use)". "Forget this bridge" asks for confirmation, then removes the saved address, token and every chat on the phone and returns Settings to its first-run state.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-08-09-settings-notifications-and-pairing.spec.ts` › "Forget this bridge: confirm copy, then bridge stops, chats are wiped and Settings reloads in first-run state"

## Sub-features

- `bridges-list` "Paired bridges (failover order)" lists `1. <addr>` and `2. <addr> (in use)` after a second pairing [UNCOVERED].
- `forget-confirm` Forget this bridge shows a confirm with the exact copy; Cancel keeps everything [UNCOVERED].
- `forget-wipe` Confirm wipes saved settings and chat storage and shows first-run Settings; a reload opens Pair [UNCOVERED].

## How to get to it (user POV)

- Chats tab, then Open settings; scroll to the paired bridges list and the Forget this bridge button.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- For the list: a second isolated bridge from `createBridge()`. For forget: one paired bridge with an owned `New chat` row.

- **Open Settings.** `await pair(page,bridge)`, then `page.getByRole('button',{name:'Open settings'}).first().click()`.
- **Two bridges.** Choose `Pair nearby with sonic code`, fill the second bridge address and token, Pair over Tailscale. Reopen Settings and expect `getByTestId('settings-bridge-endpoints')` text `1. <first>` then `2. <second> (in use)`.
- **Forget, cancel.** Register `page.once('dialog')` and dismiss, then click `getByRole('button',{name:'Forget this bridge',exact:true})`. The dialog text is "Forget this bridge?" plus "Removes the saved address, token, and every chat on this phone." and the button stays.
- **Forget, confirm.** Accept the dialog. The `Pair with sonic code instead` link and intro return, Address and Token are empty, `localStorage['dash.settings.v1']` is null and the `dash.conversations*` keys are gone. The Left/Right/Automatic thumb radios are disabled. Reload: the Pair screen opens.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/paired-bridges.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Show the list order before forgetting and the cleared local storage after.

## Gotchas

- Forget uses `window.confirm` on web; attach the dialog handler before the click or the click hangs.
- Forget stops the app's connection to the bridge and wipes phone-side state; the bridge process itself keeps running. Assert the phone state and a closed connection in `bridge.log`, not bridge death.
- Failover order is pairing order, and `(in use)` follows the active connection, not the last one listed.
- Draft locators all exist in app source (checked by grep).
