# First-run connect (Settings)

On first run the Settings screen shows a "Pair with sonic code instead" link, an intro line, and Address, Token and Folder fields. Connect stays disabled until Address and Token are valid, then the status reads "Connected to <host>" and the app moves to Main.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-08-09-settings-notifications-and-pairing.spec.ts` › "valid address + execution token connects: status is green Connected to <host> and the app goes to Main"

## Sub-features

- `first-run-intro` sonic link and intro text show, paired-only sections hidden [UNCOVERED].
- `first-run-fields` Address, Token (hidden input) and Folder accept text; Connect disabled until Address and Token are non-blank [UNCOVERED].
- `first-run-connect` valid address + execution token gives "Connected to <host>" and Main [UNCOVERED].
- `first-run-wrong-token` a wrong token shows an alert and an offline status, with no navigation [UNCOVERED].

## How to get to it (user POV)

- On the Pair screen choose "Enter address and token manually".
- After "Forget this bridge" the app reloads Settings in this state.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Cold browser context with no saved settings; execution token is read from the bridge's own `.dash/token` file (never printed).

- **Open first-run Settings.** `await page.getByRole('link',{name:'Enter address and token manually',exact:true}).click()`. The heading `getByRole('heading',{name:'Settings',exact:true})` and `getByRole('button',{name:'Pair with sonic code instead',exact:true})` appear.
- **Fields.** `getByRole('textbox',{name:'Address',exact:true})`, `{name:'Token'}` (type password) and `{name:'Folder'}`. `getByRole('button',{name:'Connect',exact:true})` is disabled until Address and Token are both non-blank.
- **Connect.** Fill `bridge.address` (the loopback host and `bridge.port`) and the execution token, click Connect. Main opens (tab `Orchestra` visible) and `localStorage['dash.settings.v1']` holds the address. Reopen Settings: `getByLabel('Connected to <host>',{exact:true})` is visible and the action reads Reconnect, disabled.
- **Wrong token.** Fill a bad token and click Connect. `getByRole('alert')` shows an error, the Orchestra tab is absent, and the status label is one of the offline strings.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/first-run-connect.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The log must show an authenticated connection; reload and confirm the saved settings persist.

## Gotchas

- The exact `<host>` is whatever the bridge reports at `GET /` with the Bootstrap token. Read it, do not hard-code it.
- The connect button label changes with state: Connect, Connecting…, Save and reconnect, Reconnect.
- Never put the wrong-token string or real tokens in assertions that print on failure.
- Draft locators all exist in app source (checked by grep).
