# Chat turn

A user sends text to a laptop CLI (omp, grok, codex, claude, hermes) and sees tokens stream in.

## Sub-features

- `chat-open` opens a thread for one harness.
- `chat-send` posts a `chat` client message on `/ws`.
- `chat-stream` renders `delta` events.

## How to get to it (user POV)

- Main → Chats → a conversation, or Bots → a harness.
- Debug scenario `chat-omp` / `chat-streaming`.

## Driving it with control-dash

Preconditions:

- Phone WS already open (do not claim).
- Or debug web 8099 for layout only.

- **Layout.** Debug scenario `chat-omp` on 8099. Screenshot.
- **Live send.** Only if the unit asks. Prefer a tiny `omp` prompt. Watch bridge logs for the child spawn, then `delta` / `done`.
- **Proof.** Screenshot or a bridge log excerpt with `ws.open` and a turn id. Do not paste secrets.

## Gotchas

- Hermes via Dash is still `hermes chat -q`, not the gateway. A Hermes-looking reply is not mesh.
- Debug seed is not a live model. `chat-streaming` proves chrome, not the CLI.
