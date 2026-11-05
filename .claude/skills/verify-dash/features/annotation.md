# Annotation mode

Options, "Annotate this screen" puts a drawing overlay over the chat with a tray: tool chips (Pen, Highlighter, Arrow, Box, Circle, Eraser), ink swatches, Undo, Clear, Keep (Send and keep drawing), Send, a move-tray button and Exit. S Pen mode makes only a stylus draw. Hold to talk adds a spoken segment.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-10-11-voice-live-surface-annotation-and-lab.spec.ts` › "11.10 annotation: pan on the overlay draws; Undo removes it, Clear wipes all; S Pen mode lets the mouse pass through"

## Sub-features

- `annot-tools-ink` tool chips and ink swatches select; Undo, Clear, Keep, Send start disabled [UNCOVERED].
- `annot-draw-undo-clear` a drag draws; Undo removes one stroke; Clear wipes all [UNCOVERED].
- `annot-spen-passthrough` S Pen mode ignores mouse strokes [UNCOVERED] (stylus is native only).
- `annot-move-exit` the move-tray button toggles top/bottom; Exit leaves annotation [UNCOVERED].
- `annot-keep-send` Keep sends and keeps drawing; Send sends, exits and shows the sent preview [UNCOVERED].
- `annot-hold-to-talk` Hold to talk on web reports the missing microphone [UNCOVERED] (real audio is native only).

## How to get to it (user POV)

- In a full-screen chat open the chat options and choose "Annotate this screen".

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- A full-screen OMP chat with one finished turn, so the overlay has a chat to send to: `pair(page,bridge)`, `Create new chat`, `send(page,'ARMY annotate seed')`.

- **Enter.** `getByRole('button',{name:'Chat options'}).click()`, then `getByRole('button',{name:'Annotate this screen'}).click()`. `getByTestId('annotation-tray')` and `getByLabel('Annotation mode on',{exact:true})` appear.
- **Tools and ink.** Inside the tray click `Pen`, `Highlighter`, `Arrow`, `Box`, `Circle`, `Eraser` (each becomes `aria-selected=true`). Ink radios are `Red ink` and `Accent ink`.
- **Draw.** Drag with `page.mouse` along a free band between the tray and the composer; `Clear` becomes enabled. `Undo` removes a stroke, `Clear` removes all.
- **Tray and exit.** `Move tray to the bottom` / `Move tray to the top` toggles the tray; `Exit annotation` removes the tray.
- **Keep and Send.** `Send and keep drawing` posts the annotated turn and clears strokes; `Send annotation` posts, exits and shows `Annotation preview. Sent to ... · N strokes`. The fixture agent echoes it as `ARMY_REPLY: Annotated ...`.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/annotation.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` (strokes or the sent preview), `video.webm`, `trace.zip`, `bridge.log` (the annotated turn the bridge received).

## Gotchas

- The drawing canvas loads on first entry; retry the first stroke until `Clear` enables (allow up to ~90 s).
- The mouse acts as a finger on web; S Pen pass-through and real stylus events need a native army lane. Never drive the owner's phone.
- Entering annotation auto-starts voice, which errors on web; that is expected. Hold to talk shows an alert and no spoken segment.
- Keep strokes off the tray and the 280 dp composer clearance or they do not register.
- Draft locators all exist in app source (checked by grep).
