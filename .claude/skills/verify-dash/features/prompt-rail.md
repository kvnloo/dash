# Prompt rail

A slim rail beside the transcript lists every prompt of the chat. Dragging along it scrubs through turns and shows a `Turn preview` card (`Prompt n/N · <state>`) with Jump, Copy, Copy file path, Open PR, and Continue (then Replace draft). A `Latest reply` button returns to the newest content. Close dismisses the preview.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "prompt rail mouse scrub, Jump and Latest on real transcript"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.17 prompt rail: drag preview, Jump, Copy, Copy file path, Open PR, Continue then Replace draft, Close"

## Sub-features

- `rail-scrub` drag along the rail shows `Turn preview` with `Prompt 1/4` [covered: "prompt rail mouse scrub, Jump and Latest on real transcript"]
- `rail-jump` Jump scrolls the transcript to that prompt [covered: "prompt rail mouse scrub, Jump and Latest on real transcript"]
- `rail-latest` `Latest reply` scrolls to the newest prompt [covered: "prompt rail mouse scrub, Jump and Latest on real transcript"]
- `rail-close` `Close turn preview` dismisses the card [covered: "prompt rail mouse scrub, Jump and Latest on real transcript"]
- `rail-copy` Copy puts prompt and summary on the clipboard, label becomes `Copied` [UNCOVERED]
- `rail-copy-path` Copy file path copies the first file ref, label becomes `Path copied` [UNCOVERED]
- `rail-open-pr` Open PR opens the PR URL [UNCOVERED]
- `rail-continue` Continue asks, Replace draft fills the composer without sending [UNCOVERED]

## How to get to it (user POV)

- In an open chat with several prompts, press and drag on the thin rail at the transcript edge.
- Tap the `Latest reply` button (`Latest live reply` while a turn is running).

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent is enough for scrub, Jump and Latest (plain `ARMY_REPLY` turns). The draft's Copy path / Open PR journeys need a prompt that contains a file path and a PR URL; the fixture echoes the prompt text so that works with no extension.
- For clipboard assertions the context needs `clipboard-read`/`clipboard-write`; trap the PR host with a `page.context().route` abort so the click does not leave the machine.

- **Fill the chat.** `await openChat(page,bridge)`, then four times `await send(page,'prompt '+i+' '+'transcript text '.repeat(24))` and wait for the `ARMY_REPLY:` text each time.
- **Scrub.** `const rail=page.getByLabel('Prompt navigator',{exact:true})`; `page.mouse.move/down` at 80% of its box, move to 8% in 8 steps, `up`. `page.getByLabel('Turn preview',{exact:true})` is visible and contains `Prompt 1/4`.
- **Jump.** `await page.getByRole('button',{name:'Jump',exact:true}).click()`. `page.getByTestId('transcript-viewport').getByText(/^prompt 0 /).first()` is in the viewport.
- **Close.** `await page.getByRole('button',{name:'Close turn preview',exact:true}).click()`.
- **Latest.** `await page.getByRole('button',{name:'Latest reply',exact:true}).click()`. The `prompt 3` text is in the viewport.
- **Copy, path, PR, Continue (draft).** In the preview: `getByRole('button',{name:'Copy',exact:true})` then `Copied`; `Copy file path` then `Path copied`; `Open PR`; `Continue` then the text `Replace the composer draft with this reference? Nothing is sent` and `Replace draft`; the composer is filled and no new reply appears.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "prompt rail mouse scrub, Jump and Latest on real transcript"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` shows the transcript at the newest prompt with no preview; `video.webm` shows the scrub, the preview card and the scroll; `trace.zip`; `bridge.log` shows four prompts and no extra send from Jump/Latest.

## Gotchas

- The rail only works with a real pointer drag (mouse down, stepped move, up); a click does nothing. Do not use coordinates beyond the rail's own bounding box.
- The rail appears after enough turns exist; it needs a laid-out transcript, so wait for each `ARMY_REPLY:` before dragging.
- The preview's Copy and Open PR actions exist only when the turn has a summary, PR URL or file ref.
- `Latest reply` is `Latest live reply` while a turn is streaming; match both with a regex.
- `Continue` is a two-step confirm and never sends; the draft overwrite is the visible effect.
