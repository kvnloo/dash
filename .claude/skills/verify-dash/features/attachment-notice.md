# Attachment notice

When an attachment cannot be added, such as hitting the 8 files per message limit, the user sees an in-app notice titled `Attachment limit reached`, with a detail line, a primary action (`OK`) and `Close attachment notice`. Closing it leaves the draft and its attachments unchanged. At this checkout the notice is not mounted: the composer still calls `Alert.alert`, which shows nothing on web.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-07-08-in-app-dialogs-sheets-and-notices.spec.ts` › "limit reached shows title, detail, primary action and Close attachment notice; primary runs (dismiss)"; "Close attachment notice dismisses without changing the draft"

## Sub-features

- `notice-limit` limit reached shows title, detail `Up to 8 files per message. Remove an attachment to add another.`, `OK` and Close [UNCOVERED] (expected FAIL at 2c948dc: `AttachmentNotice` has no importer)
- `notice-primary` `OK` dismisses, attachments stay [UNCOVERED]
- `notice-close` `Close attachment notice` dismisses, draft unchanged [UNCOVERED]

## How to get to it (user POV)

- Attach eight files, then try to attach a ninth with Attach file then Files.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture is enough; the same file chooser path is driven by the covered upload test (`file chooser uploads real bytes to isolated bridge` in `e2e/mbp-army/army.spec.ts`), but that test does not assert the notice.

- **Fill to limit.** `await openChat(page,bridge)`; `page.getByRole('button',{name:'Attach file',exact:true}).click()`; `const c=page.waitForEvent('filechooser'); page.getByRole('button',{name:'Files',exact:true}).click(); (await c).setFiles(<8 small text files>)`. Each `army-limit-<i>.txt` chip is visible.
- **Hit the limit.** Click `Attach file` then `Files` again. Expect `page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Attachment limit reached',exact:true})})` visible, no browser dialog event, and no new `filechooser` event.
- **Primary.** `getByRole('button',{name:'OK',exact:true})` dismisses; all eight chips remain.
- **Close.** `getByRole('button',{name:'Close attachment notice',exact:true})` dismisses; chips unchanged.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/attachment-notice.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` of the notice over the eight chips; `video.webm`; `trace.zip`; `bridge.log` shows eight uploads and no ninth.

## Gotchas

- Without the notice, the ninth attempt silently does nothing on web; the missing dialog is the failure to report.
- Register `filechooser` and `dialog` listeners before the click, otherwise a browser dialog is dismissed silently.
- The limit is `MAX_ATTACHMENTS_PER_TURN` (8) from the shared protocol; changing it changes the detail text.
- Other notice triggers (permission denied, oversized file, picker error) are native or need fixtures this army does not have.
