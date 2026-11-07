# Chat options

Each chat has an Options control. Full-screen chats show an "Options" toggle (becomes "Hide options") with a Thinking summaries switch, Details Hide/Compact/Full, Annotate this screen and, for Hermes, a Live surface switch. Windowed chats show a sliders button, "Options. Current surface: Chat", that opens a menu with Thinking & tools, Thinking summaries, Annotate, Harness, Approvals (when pending) and, for Hermes, Surface. Holding the button and sliding scrubs a value.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "harness picker switches OMP to Hermes without sending"; "Steer running Hermes turn surfaces unsupported ACP delivery honestly"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-02-03-chat-screen-chrome-header-full-screen.spec.ts` › "03.04 Options expands to Hide options and collapses again"; "03.05 Thinking summaries switch toggles on/off and the next turn requests summaries"; "03.06 Details Hide/Compact/Full turn gold and change thinking detail for this chat"; "03.07 Annotate in options starts annotation mode with the tray"; "03.08 Hermes options show Live surface switch; on, transcript is replaced by the live surface"; "03.15 window options menu rows run their actions and Close Options closes it"; "03.16 window options Approvals row with warn dot opens Approvals"; "03.17 Hermes window options Surface row switches to Live surface"; "03.18 options trigger hold-to-scrub applies the scrubbed value on release"

## Sub-features

- `opt-open-menu` the windowed `Options. Current surface: Chat` button opens the menu. [covered: "harness picker switches OMP to Hermes without sending"]
- `opt-harness-row` the `Harness, ...` row opens the picker and picking Hermes switches the chat without sending. [covered: "harness picker switches OMP to Hermes without sending"]
- `opt-full-toggle` `Chat options` toggle shows `Hide options`. [UNCOVERED]
- `opt-thinking-summaries` summaries switch affects the next turn. [UNCOVERED]
- `opt-details-modes` `Details Hide`, `Details Compact`, `Details Full`. [UNCOVERED]
- `opt-annotate` Annotate starts the tray. [UNCOVERED]
- `opt-live-surface` Hermes Live surface switch and Surface row. [UNCOVERED]
- `opt-approvals-row` `Approvals, N pending` row. [UNCOVERED]
- `opt-hold-scrub` hold-and-slide on the trigger. [UNCOVERED]

## How to get to it (user POV)

- In a windowed chat, tap the Options button at the bottom (or hold and slide).
- In a full-screen chat, tap Options in the header strip.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `openChat(page, bridge)` for a windowed OMP chat.

- **Open the menu.** `await page.getByRole('button',{name:'Options. Current surface: Chat',exact:true}).click({noWaitAfter:true})`. Rows appear named `<label>, <value>`, e.g. `Thinking & tools, Compact`.
- **Choose a harness.** `await chooseHarness(page,'Hermes')` clicks `getByRole('button',{name:/^Harness,/})`, then the harness name. The badge (`chat-window-badge`) says `Hermes` and the composer placeholder mentions `Hermes`; Send stays disabled.
- **Close the menu.** `getByRole('button',{name:'Close Options. Current surface: Chat',exact:true})`. Harness row disappears.
- **Hide options (full screen).** `getByRole('button',{name:'Chat options',exact:true})` toggles its text between `Options` and `Hide options`; `getByRole('switch',{name:'Thinking summaries',exact:true})` appears.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "harness picker switches OMP to Hermes without sending"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The video must show the menu, the picker, and the new harness. `bridge.log` must show no turn start from the switch.

## Gotchas

- RN Web does not always expose `aria-expanded` on the toggle, so assert its text, not the attribute.
- The trigger name changes to `Options. Current surface: Live surface` after a Hermes surface switch; `chooseHarness` only matches the Chat surface.
- Hold-to-scrub needs a real mouse (`down`, wait over 250 ms, move into the row, dwell over 350 ms, `up`).
- The Surface row shows only for Hermes chats.
- Approvals appears only while the gate has a pending proposal (the fixture seeds one).
- Thinking, Details and Live surface need the scripted agent's `ARMY_THINK` and `ARMY_TOOLHANG` prompts. The committed `fixture-agent.ts` does not implement them, so those journeys cannot pass yet.
