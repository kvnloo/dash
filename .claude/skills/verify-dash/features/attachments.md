# Attachments

The paperclip (`Attach file`) opens a chooser with `Photos`, `Files` and `Cancel attachment`. Picked files appear as draft chips named `<name>, <size>` with a `Remove <name>` button, upload to the bridge, and go with the next message. At most 8 files per message. Sent messages show `Attached <name>` on the user bubble.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "file chooser uploads real bytes to isolated bridge"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 attached file shows a draft chip with name and meta; Remove clears it"; "04 attachments are capped at MAX_ATTACHMENTS_PER_TURN (8): extra files are not added"; "04 Attach file opens the chooser; Cancel closes it with nothing attached"

## Sub-features

- `attach-upload` pick a file, chip shows size not Uploading/Failed, Send delivers [covered: "file chooser uploads real bytes to isolated bridge"]
- `attach-chooser-cancel` `Cancel attachment` closes with nothing attached [UNCOVERED]
- `attach-remove` `Remove <name>` drops the chip [UNCOVERED]
- `attach-cap` 9 picks keep 8 chips; full draft raises `Up to 8 files per message.` [UNCOVERED]
- `attach-sent-label` user bubble shows `Attached <name>` [UNCOVERED] (the committed test does not assert it)

## How to get to it (user POV)

- Tap the paperclip in the composer, then `Photos` or `Files`.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Web file chooser only (Playwright `filechooser`); no native picker.

- **Open chooser.** `await openChat(page,bridge); await page.getByRole('button',{name:'Attach file',exact:true}).click({noWaitAfter:true})`. `getByTestId('attachment-sheet')` shows `Photos`, `Files`, `Cancel attachment`.
- **Pick.** `const chooser=page.waitForEvent('filechooser'); click Files; await (await chooser).setFiles({name:'army-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('ARMY_ATTACHMENT_BYTES\n')})`. `getByText('army-evidence.txt',{exact:true})` and `getByLabel(/^army-evidence\.txt,/)` whose label matches `B|bytes` and not `Uploading|Failed`.
- **Send.** `composer(page).fill('read attachment fixture')`, click `Send`. `ARMY_REPLY:` appears. Bubble label: `getByLabel('Attached army-evidence.txt')`.
- **Remove / cap.** `getByRole('button',{name:'Remove army-evidence.txt',exact:true})`; for the cap, `setFiles` with 9 files and expect 8 `Remove army-cap-` buttons.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "file chooser uploads real bytes to isolated bridge"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the chip with a size and the reply. Side effect: the bytes `ARMY_ATTACHMENT_BYTES` exist in the bridge's upload directory inside the test's temporary HOME (check before the bridge is cleaned up), and `bridge.log` shows the upload.

## Gotchas

- The committed test asserts the chip label and the reply, not the bytes on disk; verify the upload directory yourself or the proof is only the UI.
- The Alert for the 8-file cap is a native Alert, a no-op on react-native-web, so on web only the capped chip count is observable.
- Attach is disabled while the bridge is offline or the chat target has ended.
- `Photos` goes through the same chooser; image-specific paths (paste image, camera) are native only.
