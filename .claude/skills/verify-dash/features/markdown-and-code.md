# Markdown and code blocks

A streamed assistant reply renders as formatted text: headings are larger, lists and bold render as such, inline code is styled, and fenced code shows in a block with a `Copy <language> code` button. The text grows by delta while the turn runs and settles when the turn finishes (Stop turns back into Send).

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.01 streamed fixture reply renders markdown (heading, list, bold, code), grows by delta and finalizes on done"; "07.02 code block Copy <language> code puts the code on the clipboard and shows Copied"

## Sub-features

- `md-render` heading, list, bold and inline code render, raw `#` / backticks are not shown [UNCOVERED]
- `md-stream` first delta is visible before the reply ends, then the turn finalizes (Stop gone, Send back) [UNCOVERED]
- `code-copy` fenced block shows `Copy <language> code`; tapping puts the code on the clipboard and the label becomes `Copied` [UNCOVERED]

## How to get to it (user POV)

- Send any prompt in an open chat and read the assistant reply in the transcript.
- Open an existing chat whose history contains markdown replies.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent only streams plain text (`ARMY_STREAM_BEGIN`, then `ARMY_REPLY: <prompt>`), so no markdown ever appears. The draft relies on `ARMY_R07_MD` scenarios in an uncommitted fixture-agent extension; that extension must be committed first (the uncommitted `rc3-11-fx-fixture.ts` only scripts the Live surface, not replies).
- The test context grants `clipboard-read` and `clipboard-write` (`test.use({permissions:[...]})`).

- **Open a chat.** `await openChat(page,bridge)` (draft uses a full-screen new chat via `getByRole('button',{name:'Create new chat',exact:true})`).
- **Send the scripted prompt.** `await send(page,'ARMY_HANG ARMY_R07_MD markdown journey')`. The `Stop` button appears.
- **Streaming.** `await expect(page.getByText(/ARMY_MD_PART1/).first()).toBeVisible()` while `ARMY_MD_DONE` count is 0. The list items are visible before the end.
- **Finalized.** `await expect(page.getByText(/ARMY_MD_DONE/).first()).toBeVisible({timeout:15000})`, `Stop` count 0, `Send` visible.
- **Rendered, not raw.** Heading font size is larger than a paragraph (`getComputedStyle`), `page.getByText(/```ts/)` count is 0.
- **Copy code.** Tap Copy. `await page.getByRole('button',{name:'Copy ts code',exact:true}).click()`. The label changes to `Copied` and `navigator.clipboard.readText()` equals the code.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/markdown.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` shows the heading, list, bold, inline code and the code block with `Copied`; `video.webm` shows the text growing; `trace.zip`; `bridge.log` shows one prompt and no agent error.

## Gotchas

- The accessible name uses the fence language as written: ```` ```ts ```` gives `Copy ts code`, no language gives `Copy code code`.
- Language labels with spaces use only the first word. `html`, `mermaid`, `genui`, `openui` fences do not become a code block (see `genui-blocks.md`).
- Bold has no role: compare computed font weight or family against its parent, do not look for `strong`.
- Clipboard reads fail in a Playwright context without the permission grant.
- `ARMY_HANG` keeps the main handler open, so the scenario block itself must end the turn or Stop is needed.
