# A running turn survives a missing roster row

While a turn runs, the app polls the host roster. If the chat's native row is absent from the roster (as for an ephemeral ACP chat), the app must not declare the chat ended: the user can still queue the next message and does not see "This chat has ended on the host."

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "ephemeral ACP regression" › "a missing roster row must not terminate a bridge-owned running turn"

## Sub-features

- `roster-missing-keeps-turn` after a real `/roster` poll the composer still offers `Queue`, no ended banner [covered: "ephemeral ACP regression a missing roster row must not terminate a bridge-owned running turn"]

## How to get to it (user POV)

- Start a long reply in a new chat and leave it running past one 10 s roster poll.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The test sets `persistSession:false`, so the roster has no native rows for the chat.

- **Start.** `await openChat(page,bridge); await send(page,'ARMY_HANG ephemeral ACP regression')`; `ARMY_STREAM_BEGIN` visible.
- **Wait for a real poll.** `page.waitForResponse` for `http://127.0.0.1:<port>/roster` with status 200 or 304 (up to 45 s), then let React paint.
- **Assert.** `composer(page).fill('queue behind still-running bridge turn')`; `getByRole('button',{name:'Queue',exact:true})` is enabled; `getByText('This chat has ended on the host. Its saved history is still on this phone.',{exact:true})` has count 0.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "a missing roster row must not terminate a bridge-owned running turn"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The trace must contain a `/roster` response after the turn started; `final.png` shows the `Queue` button and no ended banner.

## Gotchas

- The test takes up to about 45 s (waits for the poll); a fixed sleep false-greens, so never replace the response wait.
- The banner text is `store/app.ts` target-stale copy; the regression is exactly that it must not appear.
- `ARMY_HANG` is never stopped by the test; the bridge teardown ends it.
- The test can pass vacuously if the page is backgrounded; it calls `page.bringToFront()` for this reason.
