# Notifications

Settings has a Notifications section. In the installed Android build it has an on/off switch, a permission line and a link to Android notification settings, and the app raises silent notifications for replies, action needed and errors. On web and Expo Go it shows only a text saying notifications need the installed build.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-08-09-settings-notifications-and-pairing.spec.ts` › "Notifications on web: section renders the web text; native toggle and Android settings are absent"

## Sub-features

- `notif-web-text` web shows the "require the installed Dash build" text and no switch [UNCOVERED].
- `notif-native-toggle` switch, permission line and "Open Dash app settings in Android" [UNCOVERED] (native only).
- `notif-push` a silent push on reply / action needed / error and agent-report posting to the phone [UNCOVERED] (native only).

## How to get to it (user POV)

- Chats tab, Open settings, Notifications section.
- Tap a delivered notification (native) to open its chat, Approvals or Notices target.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired session via `pair(page,bridge)`.

- **Open Settings.** `await pair(page,bridge)`, then `page.getByRole('button',{name:'Open settings'}).first().click()`.
- **Web text.** `page.getByText('Notifications',{exact:true})` and `page.getByText('Notifications and incoming Android shares require the installed Dash build. Expo Go and web remain usable without them.',{exact:true})` are visible. `getByRole('switch',{name:/^Notifications/})` and `getByRole('button',{name:'Open Dash app settings in Android'})` have count 0.
- **Run.** No committed spec. Add the web-text journey as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/notifications.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The page must show the web text and no switch.

## Gotchas

- The native switch, permission prompts and push delivery cannot be proven on web. A native army lane is needed. Never drive the owner's phone, adb or Maestro for this.
- Agent reports reach the phone through the bridge notice listener; the web-reachable half is the Notices screen (see `notices-screen.md`).
- Draft locators all exist in app source (checked by grep).
