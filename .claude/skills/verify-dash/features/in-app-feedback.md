# In-app feedback switch

Settings has an In-app feedback switch showing On or Off. The setting persists. With it On, long-pressing a chat row opens in-app feedback instead of the delete confirm. With it Off, long-press asks "Delete chat?" for that phone only.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-08-09-settings-notifications-and-pairing.spec.ts` › "In-app feedback switch toggles On/Off, persists, and changes chat-row long-press"

## Sub-features

- `feedback-toggle` the switch flips On/Off and shows the state [UNCOVERED].
- `feedback-persist` the choice is saved in settings [UNCOVERED].
- `feedback-longpress` Off: long-press shows the delete confirm; On: no confirm, opens the chat [UNCOVERED].

## How to get to it (user POV)

- Chats tab, Open settings, In-app feedback switch (paired only).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired with one owned `New chat` row: `pair(page,bridge)`, create it, then Back to the Chats pane.

- **Open Settings.** `page.getByRole('button',{name:'Open settings'}).first().click()`.
- **Turn Off.** `const sw=page.getByRole('switch',{name:'In-app feedback',exact:true})`: starts `aria-checked=true` with text On. Click it: `false`, text Off, and `localStorage['dash.settings.v1']` has `"inAppFeedback":false`.
- **Off long-press.** Back, Chats tab, press and hold the exact `chatRow(page)` for about 900 ms with `page.mouse.down()`/`up()`. A dialog reads "Delete chat?" then "This removes it from this phone only."; dismiss it and the row stays.
- **On long-press.** Turn the switch On again, repeat the hold. No dialog appears and the chat opens (`composer(page)` visible).
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/in-app-feedback.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Show both outcomes of the long-press and the persisted flag.

## Gotchas

- Register the `page.once('dialog')` handler before the long-press; the confirm is `window.confirm` on web.
- Target the specific `New chat` row, never the first roster row (never delete a real chat).
- The switch is absent on first-run Settings; pair first.
- Draft locators all exist in app source (checked by grep).
