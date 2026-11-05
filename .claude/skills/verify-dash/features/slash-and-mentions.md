# Slash commands and @ mentions

Typing `/` in the composer opens a `Composer suggestions` panel headed `<harness> commands` with the commands the harness advertises; tapping one inserts it. `/usage` is always offered and opens a usage card. Typing `@` offers workspace files, sessions, bots and agents to mention. If suggestions cannot load, a warning appears with `Retry loading suggestions`.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-03-04-composer-controls-chips-and-send-gate.spec.ts` › "04 slash: harness commands listed, tap inserts, no match shows the empty copy"; "04 slash /u shows /usage row and tapping it opens the /usage card"; "04 mention: @ lists workspace files and tapping one inserts the mention"; "04 mention: a suggestion load failure shows a warning with Retry loading suggestions"

## Sub-features

- `slash-list` `/` shows `<harness> commands`, rows insert `/name ` on tap [UNCOVERED]
- `slash-empty` no match shows `No matching commands advertised by this harness.` [UNCOVERED]
- `slash-usage` `/u` offers `/usage`; tap opens `Usage details` card, `Close usage details` closes it [UNCOVERED]
- `mention-files` `@army-mention` lists `@army-mention-target.md`, tap inserts `@army-mention-target.md ` [UNCOVERED]
- `mention-retry` load failure shows an alert and `Retry loading suggestions` re-requests [UNCOVERED]

## How to get to it (user POV)

- In any chat, type `/` or `@` as the first character of a word in the `Message` box.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Slash command rows need the bridge to advertise commands; the committed fixture agent advertises none (the draft relies on an `army-commands.json` hook the committed `fixture-agent.ts` lacks). `/usage` and the empty copy work without it.
- Mentions need a Git workspace in the bridge's working directory (`git init` plus one tracked-or-unignored file) or the load-failure path is shown instead.

- **Slash list.** `await composer(page).fill('/')`; `const panel=page.getByLabel('Composer suggestions',{exact:true})`; heading `panel.getByText(/^\S+ commands$/)`; row `panel.getByRole('button',{name:'/army-review',exact:true})`; click puts `/army-review ` in the box.
- **Empty.** `composer(page).fill('/zzzarmynomatch')`, then `getByText('No matching commands advertised by this harness.',{exact:true})`.
- **Usage.** `fill('/u')`, `getByRole('button',{name:'/usage',exact:true})`, click, then `getByLabel('Usage details',{exact:true})` and `getByRole('button',{name:'Close usage details',exact:true})`.
- **Mention.** `fill('@army-mention')`; `panel.getByText('Mention a file, session, bot or agent',{exact:true})`; row `@army-mention-target.md`; click inserts it.
- **Failure and Retry.** Non-Git cwd: `fill('@')`, `panel.getByRole('alert')`, click `Retry loading suggestions` and see a new `/suggestions` request.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/slash-and-mentions.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They must show the panel with the rows, the inserted text in the box, and for Retry a second `/suggestions` request in the trace.

## Gotchas

- The panel's `/usage` row only appears when the chat has a usage handler; the context card for `/usage` is the same component as the context gauge card.
- File mentions come from the bridge cwd's Git listing; a plain temp dir yields the warning, so the success and failure journeys need different bridge setups.
- The slash command list for a harness comes from the agent, so on the committed fixture the list stays empty after loading.
