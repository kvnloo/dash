# Orchestra detail (product)

Opening a product row from Orchestra search shows an OrchestraDetail screen headed "<project> · <state>" with its agents. "Open <profile>" starts a chat with that agent, and the project's linked chats appear as items that reopen the chat.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-09-10-orchestra-bots-approvals-and-trace-sc.spec.ts` › "product opens OrchestraDetail "<project> · <state>"; Open <profile> opens a chat; the linked chat item opens it"

## Sub-features

- `detail-open` a product row opens the screen titled Orchestra with the label "<project> · <state>" [UNCOVERED].
- `detail-open-profile` "Open <profile> in <project>" opens a chat with that agent [UNCOVERED].
- `detail-linked-chat` after opening a chat, "No linked chats yet" is replaced by a chat item that reopens it [UNCOVERED].

## How to get to it (user POV)

- Orchestra tab, type `@product <project>` in the composer-style search, tap the Product row.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired via `pair(page,bridge)`; the project name is the bridge's working-folder basename.

- **Find the product.** `composer(page).fill('@product '+project)`, then click `page.getByRole('button',{name:new RegExp('^'+project+', Product')})`. `getByRole('heading',{name:'Orchestra',exact:true})` appears.
- **Header.** `page.getByLabel(new RegExp('^'+project+' · \\S'))` is visible, plus the `Agents` text and `No linked chats yet`.
- **Open profile.** Click `page.getByRole('button',{name:new RegExp('^Open .+ in '+project+'$')}).first()`. The composer opens in that agent's chat.
- **Linked chat.** Back. "No linked chats yet" is gone; click the chat title text (last match) and the composer opens again.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/orchestra-detail.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Show the header label and the chat reopened from the linked item.

## Gotchas

- An unavailable agent is answered with `Alert.alert`, a no-op on web, so only an online row can be proven.
- The Product row can take ~30 s to appear after the bridge boots.
- Match the project by regex on the exact basename; never click the first row.
- Draft locators all exist in app source (checked by grep).
