# Generative UI blocks

Replies can contain special fenced blocks that render as interface instead of code: `genui` / `openui` fences become cards, checklists, buttons and progress rows; `mermaid` becomes a diagram; `openui-lang` becomes a roadmap; `html` becomes an `Open HTML in stage` card. While a block is still streaming the user sees `Building interface…`, and an unparseable block shows `Interface could not be rendered.`

Status: UNCOVERED (no committed army test drives it)

## Sub-features

- `genui-widgets` `genui`/`openui` fence renders widgets (labels like `card: <title>`, `<title>: <n>%`, item buttons/checkboxes) [UNCOVERED]
- `genui-loading` unfinished fence shows `Building interface…` (progressbar) [UNCOVERED]
- `genui-invalid` bad fence shows `Interface could not be rendered.` (alert) [UNCOVERED]
- `genui-mermaid` `mermaid` fence renders a diagram [UNCOVERED]
- `genui-html` `html` fence renders `Open HTML in stage` (see `inline-media-artifact-stage.md`) [UNCOVERED]
- `genui-intent` tapping an item sends a live intent to the chat [UNCOVERED]

## How to get to it (user POV)

- Ask the agent for a form, checklist, diagram or mock-up; the reply renders it inline.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent only streams `ARMY_REPLY: <prompt>` text, so no fence is ever produced. A new scripted scenario (a `genui` fence streamed in two deltas) must be added to the fixture agent first; no draft covers this area. The rendering code is `app/src/components/genui/GenerativeBlock.tsx`.

- **Send the scenario.** `await openChat(page,bridge)`; `await send(page,'<scenario prompt>')`.
- **Loading.** Mid-stream, `page.getByRole('progressbar',{name:'Building interface',exact:true})` (fence open, not closed) is visible.
- **Rendered.** After the turn ends, widgets render by label, e.g. `page.getByLabel('card: <title>')` and a checklist item `page.getByRole('checkbox',{name:'<item>'})`. The raw fence text is not on screen.
- **Invalid.** A malformed fence shows `page.getByRole('alert')` with `Interface could not be rendered.`
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/genui.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` showing rendered widgets instead of source; `video.webm` showing loading then ready; `trace.zip`; `bridge.log`.

## Gotchas

- State comes from `generationState(language, streaming, parsed)`; only a closed fence parses, so the loading state exists only mid-stream, which the 350 ms fixture delay makes hard to catch. Add an `ARMY_HANG`-style pause between deltas.
- Items are disabled unless the chat can accept an intent (`onIntent`); a disabled item is still found by role but will not send.
- Mermaid renders in an Expo DOM webview; locate by the surrounding block, not by diagram text.
- Language is the first word of the fence lowercased; `HTML` and `html` are the same.
