# Queued messages

While a turn is running, choose Queue instead in the Hermes composer (other
harnesses expose Queue while busy). Queued parts stay in a compact stack above
the composer rather than becoming separate chat bubbles. Expand the count to
edit or delete a part. Drag its numbered handle vertically to reorder; native
accessibility increment/decrement actions also move a part.

- Merge opens the raw, in-order, blank-line-separated text in the composer.
  Save queued merge replaces the parts with one queued message. Cancel merge
  keeps the original parts. Automatic delivery pauses while the preview is open.
  The ordinary unsent composer draft is kept separately.
- Steer all now claims the ordered queue once and uses the existing busy-turn
  steer route. Its accepted/refused/fallback receipts have the same semantics as
  a normal Steer. A failed steer remains visible in chat, not silently retried.
- Clear removes unsent parts, not a running turn.
- Deliver queued as one message is a per-chat switch, default on for new and
  existing chats. Turning it off restores one-at-a-time FIFO delivery.

The persisted conversation message pairs are the queue's source of truth. The
order, edited text, attachments, merge preview and delivery preference survive
reload via the existing AsyncStorage conversation snapshot. No per-token text
has moved into the conversation store. Completion and reconnect both use the
same synchronous batch-claim function, including chats not currently displayed.

For a turn running outside Dash, the queue waits for the existing session-phase
poller to confirm idle. That poller is active only while the chat is displayed;
return to that chat to resume its idle observation. It does not start background
polling or touch the Hermes gateway lifecycle.

Merges retain attachment order. More than eight combined attachments cannot fit
the existing wire contract: the stack explains this and leaves the queue intact.
Delete parts or disable combined delivery to proceed. No file is silently dropped.
The optional model-based tidy action is not implemented; raw merge is the only
merge, and it never spends a model call or changes the instruction's meaning.

Runtime verification uses an owned scratch Hermes session, isolated bridge
credentials and loopback port, plus an independent Metro and headless browser.
No phone, gateway restart or served-worktree change is needed for these checks.
