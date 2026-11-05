# Thumb side (handedness)

Settings has a Thumb side group of three radios: Right, Left and Automatic. The chosen one shows in gold, persists across reload, and Left mirrors the main navigation row (Expand moves to the right of the dots). Automatic follows the system when it can, otherwise Right.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-08-09-settings-notifications-and-pairing.spec.ts` › "Thumb side Right / Left / Automatic: selection turns gold, persists and mirrors the nav row"

## Sub-features

- `thumb-select` each radio becomes checked and gold [UNCOVERED].
- `thumb-persist` the choice is saved in settings and survives navigation [UNCOVERED].
- `thumb-mirror` Left puts Expand right of the dots, Right/Automatic left of them [UNCOVERED].
- `thumb-disabled-unpaired` radios are disabled without a paired bridge [UNCOVERED].

## How to get to it (user POV)

- Chats tab, Open settings, Thumb side.
- Long-press the composer mic to switch hands (native).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired session via `pair(page,bridge)`; default preference is Automatic.

- **Open Settings.** `page.getByRole('button',{name:'Open settings'}).first().click()`.
- **Pick Left.** `page.getByRole('radio',{name:'Left thumb side',exact:true}).click()`. It has `aria-checked=true`, Automatic `false`, and its text color is the gold token. `localStorage['dash.settings.v1']` shows `"handedness":"left"`.
- **Mirror.** Press `getByRole('button',{name:'Back'}).first()`. Compare x-centres of `getByRole('button',{name:'Expand',exact:true})` and `getByLabel('Primary mobile workspace',{exact:true})`: Expand is right of the dots for Left, left of them for Right.
- **Right and Automatic.** Repeat with `Right thumb side` (persists `right`) and `Automatic thumb side` (persists `auto`).
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/handedness.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Show the nav row mirrored and the saved value after reload.

## Gotchas

- Radio accessible names include the words "thumb side" (for example `Left thumb side`).
- Automatic resolves to Right on web (no system handedness signal), so Automatic and Right look identical there.
- Gold is a computed `rgb()` from the night theme; assert it on the radio's inner text element, not the pressable.
- The native system-handedness signal and mic long-press need a native lane.
- Draft locators all exist in app source (checked by grep).
