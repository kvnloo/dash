# Notices screen

Notices ("Agent reports") lists reports that agents posted through the bridge. A report with a valid `dash://` target shows an "Open in Dash →" button that opens that screen. Malformed or unknown targets show as inert text and never crash the app.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-08-09-settings-notifications-and-pairing.spec.ts` › "Notices lists agent reports; a target opens it; malformed targets are inert and never crash"

## Sub-features

- `notices-list` every posted report title and body is listed [UNCOVERED].
- `notices-open-target` a valid target (`dash://approvals`) gets Open in Dash → and opens Approvals [UNCOVERED].
- `notices-malformed-inert` malformed chat targets and unknown hosts show as text only, no page error [UNCOVERED].

## How to get to it (user POV)

- Chats tab, Open settings, then "Notices · Agent reports".
- Tap a delivered agent-report notification (native only).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired session via `pair(page,bridge)`. Reports are posted by the test over the bridge's own local notice listener (URL printed in `bridge.logs()`), authorized with the bridge execution token read from its `.dash/token`.

- **Seed reports.** POST JSON `{title,body,url?}` to the listener `/notice`; expect HTTP 201 for each. Use `url:'dash://approvals'` for one, none for another, and malformed ones such as `dash://chat/a/b`, `dash://chat/..`, `dash://elsewhere/x`.
- **Open Notices.** `page.getByRole('button',{name:'Open settings'}).first().click()`, then `page.getByRole('button',{name:'Notices · Agent reports',exact:true}).click()`. `getByRole('heading',{name:'Notices',exact:true})` appears and each title is visible.
- **Inert targets.** `getByRole('button',{name:'Open in Dash →',exact:true})` has count 1 (only the valid target). The raw malformed URLs show as plain text.
- **Open target.** Click it. `getByRole('heading',{name:'Approvals',exact:true})` appears and Notices is gone. Collect `errors` and expect no `PAGEERROR` entries.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/notices.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log` (notice listener line plus the 201s) and `console.json` (no page errors).

## Gotchas

- The public bridge port answers `/notice` with 403; use the separate loopback notice listener.
- The notice listener line only appears if the bridge's local listener started; check `bridge.log` first.
- Reports arrive asynchronously; wait up to ~20 s for each title.
- Delivery as a phone notification is native only (see `notifications.md`).
- Draft locators all exist in app source (checked by grep).
