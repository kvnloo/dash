# Orchestra graph

The Orchestra pane (the cold app's first tab) shows a read-only evidence graph of hosts, chats, subagents and repos. Four mode tabs switch the view: Fleet telemetry, Lineage tree, Work hubs and Triage lanes. Tapping a node opens Node details with Open chat, Open PR and Close, a legend highlights or isolates a kind, Focus narrows to a subtree, and busy hubs have Show more/fewer sessions.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-09-10-orchestra-bots-approvals-and-trace-sc.spec.ts` › "graph renders with mode tabs; each tab switches the view (Fleet telemetry, Lineage tree, Work hubs, Triage lanes)"

## Sub-features

- `graph-modes` Fleet / Lineage / Work / Triage tabs switch the view [UNCOVERED].
- `graph-node-details` tap a node: Node details with state, reason, path, parent, children; Close [UNCOVERED].
- `graph-open-chat` Open chat opens that session's chat [UNCOVERED].
- `graph-open-pr` Open PR opens the GitHub pull request [UNCOVERED].
- `graph-legend` tap highlights a kind, hold shows only that kind [UNCOVERED].
- `graph-focus` Focus narrows to the selected subtree, All restores, Reset clears [UNCOVERED].
- `graph-hub-more` Show N more sessions / Show fewer sessions on a hub [UNCOVERED].

## How to get to it (user POV)

- Open Dash: the first tab is Orchestra. Pick a mode tab inside the graph.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The fixture bridge only has the two default rows. Richer graphs need native Hermes rows seeded into the bridge's disposable home while the bridge is stopped, then restarted (see Gotchas). Pair with `pair(page,bridge)` and stay on Orchestra.

- **Modes.** `page.getByTestId('orchestra-graph')` is the graph. Click `getByTestId('orchestra-graph').getByRole('button',{name:'Work'})` (also Fleet, Lineage, Triage); the clicked tab has `aria-selected=true`. Lineage shows "Delegation tree · N recorded links"; Triage shows "Failing / stalled".
- **Node details.** Node cards are buttons named `<label>. <kind>: <label>, <state>. ...`. Click one and `page.getByLabel('Node details',{exact:true})` shows kind, state, harness and model. Click its `Close` text to dismiss.
- **Open chat / PR.** In Node details click the `Open chat` text; the composer opens. For a PR node, `Open PR` opens a `github.com` popup (answer it with a context route stub).
- **Legend.** `getByLabel('Graph legend. Tap to highlight, hold to show only.',{exact:true})` with `Legend chat|subagent|repo` buttons. Tap dims other kinds; a 900 ms hold removes them.
- **Focus and hub.** `Focus` / `All` / `Reset` texts in the graph footer. On a hub, `getByRole('button',{name:/^Show \d+ more sessions on <repo>$/})` and `Show fewer sessions on <repo>`.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/orchestra.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Each mode must show its own header text; Open chat must land in the right session.

## Gotchas

- The draft's seed script `rc3-09-10-seed.ts` is not committed. Without seeded native rows the graph only shows a roster-only fallback ("Online · roster only"), so Work, Lineage and Triage assertions fail.
- The draft asserts "Online · bridge roster" in Fleet; that string is not in app source (the roster-only fallback says `Online · roster only`). Fix before committing.
- Seed native rows with the bridge stopped; they are indexed at boot. The restarted bridge keeps its port.
- Never open github.com for real; route it to a local stub and assert the URL.
- Draft locators otherwise exist in app source (checked by grep).
