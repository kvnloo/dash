# Pair screen

A cold, unpaired Dash opens on "Pair with your laptop". The user can pair with a six-character code, over Tailscale with the laptop address plus a Bootstrap token, with a z0bridge pairing link, or by listening for a pairing sound, and can fall back to typing address and token on Settings.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "pairing, Chats tab, open and close real chat window"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-08-09-settings-notifications-and-pairing.spec.ts` › "Pairing code input uppercases and strips non-alphanumerics; a live code pairs"

## Sub-features

- `pair-tailscale` Address + Bootstrap token + Pair over Tailscale opens Main [covered: "pairing, Chats tab, open and close real chat window"].
- `pair-wrong-token` a wrong Bootstrap token shows "Pairing failed. Check the connection details." and stays on Pair [UNCOVERED].
- `pair-code` the Pairing code box uppercases and strips non-alphanumerics, and Pair with code needs address, token and a full code [UNCOVERED].
- `pair-code-bad` a bad code shows the pairing-failed error [UNCOVERED].
- `pair-z0bridge-link` z0bridge pairing link + Confirm z0bridge pairing [UNCOVERED] (web refuses safely).
- `pair-sonic` Listen for pairing sound [UNCOVERED] (web ends in an error).
- `pair-manual` Enter address and token manually opens first-run Settings [UNCOVERED].

## How to get to it (user POV)

- Open Dash with no saved bridge: the app lands on Pair.
- From paired Settings, choose Pair nearby with sonic code.
- From first-run Settings, choose "Pair with sonic code instead".
- Open a `dash://connect?...` link (native app; on web the same route is `<web>/connect`).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- A fresh browser context (no saved settings) and a per-test isolated bridge from the `bridge` fixture. The bootstrap token is `bridge.bootstrap`.

- **Pair over Tailscale.** Use the helper `await pair(page,bridge)`. It fills `page.getByPlaceholder('100.64.0.1',{exact:true})` with `bridge.address` (the loopback host and `bridge.port`), fills `page.getByLabel('Bootstrap token',{exact:true})`, then clicks `page.getByRole('button',{name:'Pair over Tailscale',exact:true})`. The tab bar appears and the Chats tab is selected.
- **Wrong token.** Fill a bad token, click Pair over Tailscale, and expect `page.getByLabel('Pairing failed. Check the connection details.',{exact:true})`. Pair stays on screen and `localStorage['dash.settings.v1']` is still null.
- **Code entry.** `page.getByRole('textbox',{name:'Pairing code',exact:true}).fill('a1-b2 c3d4')` must read `A1B2C3`. Get a live code with an authorized `GET /pair` on the bridge, then click `getByRole('button',{name:'Pair with code',exact:true})`.
- **z0bridge link.** `getByLabel('z0bridge pairing link',{exact:true})` then `getByRole('button',{name:'Confirm z0bridge pairing',exact:true})`. Web shows "Use the native Dash app for z0bridge pairing. ...".
- **Sonic.** `getByRole('button',{name:'Listen for pairing sound',exact:true})` is enabled only with address and token filled. On the virtual display it ends in the pairing error and never navigates.
- **Manual.** `getByRole('link',{name:'Enter address and token manually',exact:true})` opens Settings.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "pairing, Chats tab, open and close real chat window"`. The other sub-features are UNCOVERED: add a spec for them in `e2e/mbp-army/pair-screen.spec.ts` and drive it with `-g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip` and `bridge.log`. They must show the Chats tab selected after pairing. The saved settings hold a new execution token that differs from the Bootstrap token.

## Gotchas

- The cold app opens Pair only when no settings are saved; a reused browser profile skips it.
- The placeholder `100.64.0.1` is the address box's own hint, not a real target. Always fill the loopback host with `bridge.port`.
- Never assert the Bootstrap token's value in logs or screenshots beyond the fixture's disposable token.
- Sonic pairing and z0bridge enrolment need a native lane (microphone, native WebSocket headers). Web can only prove the honest error path.
- Draft locators all exist in app source (checked by grep).
