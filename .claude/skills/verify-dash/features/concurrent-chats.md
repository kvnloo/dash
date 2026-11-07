# Chats reply side by side, and in order

Several chats can have an agent replying at once. A message sent in a second chat while the first chat's agent is still replying is answered at once, never refused with "ACP supervisor busy" (issue #498). Two messages to the same chat wait their turn: the second is queued behind the first and answered after it.

Status: COVERED by `e2e/mbp-army/concurrent-turns.spec.ts` › "a message in a second chat is answered while the first chat is still replying", › "two messages to one chat, back to back, are both answered in order" and › "two windows sending into one chat at the same moment: the second waits and is answered after the first"

## Sub-features

- `chats-side-by-side` second chat answered while the first agent is still replying [covered: "a message in a second chat is answered while the first chat is still replying"]
- `same-chat-queued-in-order` second message waits behind the first and is answered after it [covered: "two messages to one chat, back to back, are both answered in order"]
- `host-turn-cap` the 9th simultaneous turn is refused with a plain sentence (`DASH_ACP_MAX_TURNS`, default 8) [UNCOVERED]
- `same-chat-from-two-windows` two clients writing into one chat at the same moment: the bridge makes the second wait (`supervisor.ts` lanes) [covered: "two windows sending into one chat at the same moment: the second waits and is answered after the first"]

## How to get to it (user POV)

- Send a message, leave the chat, open or create another chat and send there while the first agent is still working.
- In one chat, send a message and, while it runs, type the next one and tap `Queue`.
- Send into the same chat from two phones or windows at once.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The fixture agent holds any prompt containing `ARMY_HOLD` until the spec creates `$HOME/army-release` in the bridge's directory (`bridge.dir`), and logs every prompt's start and end to `army-acp-turns.jsonl` there. Overlap is therefore by construction, not a race against a clock.

- **Side by side.** `openChat`, `send(page,'ARMY_HOLD first chat is held')`, `Stop` visible. Leave (`Close chat window`), `Create new chat`, `send(page,'second chat answers at once')`. `ARMY_REPLY: second chat answers at once` appears while the first agent is still held. Reopen the first chat with `chatRow(page)`: `Stop` is still shown and it has no reply. Write `army-release`: its `ARMY_REPLY:` arrives.
- **Same chat.** `send(page,'ARMY_HOLD first message of two')`, fill the next text, click `Queue`: `1 queued` shows, the host has one turn and no `ARMY_REPLY:` exists. Release: the first reply, then the second, in transcript order. `bridge.log` has one `session=new` and one `session=resume` `ws.chat`.
- **Two windows.** Window A (`page`) opens the host's live OMP row `getByTestId('chat-row-live:omp:army-fixture-session')` and sends `ARMY_HOLD window A message`. Window B (`browser.newContext()`, paired the same way) opens the same row and sends `window B message`. `bridge.log` shows two `ws.chat ... session=resume`, the host has one agent turn and window B shows no reply and no busy text. Release: A's reply, then B's.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/concurrent-turns.spec.ts -g "second chat|back to back|two windows"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`, and the bridge directory's `army-acp-turns.jsonl` (second prompt starts after the first starts and ends before it ends).

## Gotchas

- The app queues a same-chat message on the phone until the running turn settles, so one window never makes the bridge wait on a same-chat turn; "back to back" passes with or without the bridge's per-chat wait. Only the two-window journey reaches it.
- Window B's video is `window-b/*.webm` and its screenshots are `window-b-*.png` in the test directory; the `page` fixture records window A only.
- Every fixture session is `army-fixture-session`, so two new chats resume the same id on their second turn. These specs only send the first turn of each new chat.
- The Chats list keeps hidden `Last reply · ...` previews: match replies with `getByText(rx).filter({visible:true}).first()`.
