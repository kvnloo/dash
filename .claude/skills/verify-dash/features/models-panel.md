# Models panel

Settings has a Models + row. Opening it shows read-only host model assignments with a Refresh models button, and the row reads Models − while open. Tapping again closes it.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-08-09-settings-notifications-and-pairing.spec.ts` › "Models + opens the models panel as Models −; tap again closes it"

## Sub-features

- `models-open` Models + expands the panel (Refresh models, "Read-only host assignments ...") [UNCOVERED].
- `models-close` a second tap collapses it back to Models + [UNCOVERED].
- `models-refresh` Refresh models reloads the assignments [UNCOVERED].

## How to get to it (user POV)

- Chats tab, Open settings, then the Models row.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired session via `pair(page,bridge)`.

- **Open Settings.** `await pair(page,bridge)` then `page.getByRole('button',{name:'Open settings'}).first().click()`.
- **Expand.** The row's accessible name is `Models` (hint toggles Expand/Collapse). `const models=page.getByRole('button',{name:'Models',exact:true}); await models.click()`. Its text becomes `Models −`, `getByRole('button',{name:'Refresh models',exact:true})` is visible and the text starting `Read-only host assignments` shows.
- **Collapse.** Click `models` again: text returns to `Models +` and both disappear.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/settings.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` (panel open), `video.webm`, `trace.zip`, `bridge.log`. The log should show the model request when Refresh models is clicked.

## Gotchas

- The accessible name is `Models`, not `Models +`; match the text with `toHaveText('Models −')`.
- The minus is the Unicode minus (U+2212), not a hyphen.
- The fixture bridge has no real model catalog; assert the panel's structure, not specific model names.
- Draft locators all exist in app source (checked by grep).
