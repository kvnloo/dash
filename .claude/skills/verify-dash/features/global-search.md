# Global search bar

The bar at the bottom of Main reads "Search or message Dash". A Mention @ button inserts `@`, Voice input opens Voice (it becomes Send once text is typed), and typing lists matching rows: Chats (conversations), Harness, Skill, Plugin, Product and Bot rows. Chat matches page older results ("See all chats matching ...", "Keep searching older messages").

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-00-01-navigation-shell-top-nav-and-bridge-p.spec.ts` › "Mention inserts @, Voice input opens Voice, Send submits the note into a chat"; "typing a query lists a conversation row; tapping it opens that chat"; "harness search row opens that harness chat; skill and plugin scopes answer honestly"; "product search row opens OrchestraDetail for that project"; "bot search row without a chat target is labelled unavailable and does not open a chat"; "chat-scope search loads older matches when scrolled to the end"

## Sub-features

- `search-mention` Mention inserts `@` and focuses the bar. [UNCOVERED]
- `search-voice` Voice input opens Voice. [UNCOVERED]
- `search-send-note` Send puts the note into a chat composer. [UNCOVERED]
- `search-chat-row` a query lists a conversation row that opens that chat. [UNCOVERED]
- `search-harness-row` `/harness` lists harnesses; a row opens that harness chat. [UNCOVERED]
- `search-skill-plugin` `/skill` and `/plugin` say the bridge reports no inventory. [UNCOVERED]
- `search-product-bot` `@product` and `@bots` rows. [UNCOVERED]
- `search-older-paging` chat scope loads older matches. [UNCOVERED]

## How to get to it (user POV)

- The bar is always at the bottom of Main. Type in it, or tap Mention or Voice input.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired. The fixture roster has a Hermes session titled `ARMY native fixture` (the search target).

- **Mention.** `const bar=page.getByRole('textbox',{name:'Message',exact:true})` (placeholder `Search or message Dash`). `await page.getByRole('button',{name:'Mention',exact:true}).click()`. The bar value is `@` and focused.
- **Voice.** `await page.getByRole('button',{name:'Voice input',exact:true}).click()`. Heading `Voice` or `Live call` appears; `Back` returns.
- **Chat row.** `await bar.fill('ARMY native')`. `getByRole('button',{name:/^ARMY native fixture,/}).first()` appears (up to 30 s) and `getByRole('button',{name:'See all chats matching “army native”'})` shows. Click the row; the chat composer is visible.
- **Send note.** `await bar.fill('army global note')`; `Voice input` disappears; click `getByRole('button',{name:'Send',exact:true})`. The chat composer has the value `army global note`.
- **Harness and inventory.** `await bar.fill('/harness')` shows `OMP, Harness, Available`. `/skill` shows `The bridge does not report skill inventory yet.`
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/global-search.spec.ts`), then `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. `final.png` must show the result rows or the opened chat; `bridge.log` must show no turn for search-only steps.

## Gotchas

- The search bar and the chat composer both have the accessible name `Message`. Disambiguate by the page you are on; on Main only the bar exists.
- Row names carry a suffix after the title (`<title>, ...`), so match with a regex.
- On web `Alert.alert` is a no-op, so a bot row with no chat target only proves "nothing navigates".
- The older-matches test needs 25 seeded Hermes sessions; the committed fixture seeds one, so that step needs its own seeding.
- Search results arrive from the bridge and can take several seconds. Wait with the 30 s timeout, never a fixed sleep.
