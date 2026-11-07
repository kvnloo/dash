# Live surface (fast lane of a Hermes chat)

Status: first cut, 2026-10-20. Owner decision: libfx and fx0 run one surface of a Hermes-owned
conversation as a fast worker node; Hermes stays in charge.

## What the owner sees

In a Hermes chat, the **Live surface** switch under the header opens the fast lane in place of the
transcript. The composer then talks to the worker:

- quick replies stream from a libfx worker (`fx`), usually faster than a full Hermes turn;
- when a choice, a tweak or a confirm is the fastest way forward, the worker builds a small control
  with fx0's own design tools and Dash renders it inline, one version per turn (v1, v2 … pills);
- a tap on that control is a **declared intent**: it is recorded in the Hermes session as a receipt,
  then the worker acknowledges it;
- **Ask Hermes** (or just asking the worker to have Hermes do something) sends the question to the
  owning Hermes session; Hermes's answer appears as its own gold-ruled line;
- **In Hermes · N receipts** reads back what Hermes's own database holds for this surface.

Turning the switch off returns to the Hermes transcript. Nothing in the fast lane writes into it.

## How it is wired

```
phone ──ws── Dash bridge ──HTTP+SSE── z0bridge --fx ──┬── libfx worker (fx0 design kit, Codex plan)
                                                       └── Hermes ACP (owner of the conversation)
```

- Protocol: `shared/live.ts` (`live_open`, `live_turn`, `live_intent`, `live_receipts` and their
  replies), wired into `shared/protocol.ts`.
- Bridge: `bridge/src/live-surface.ts` holds z0bridge's address and token
  (`DASH_Z0BRIDGE_URL`, `DASH_Z0BRIDGE_TOKEN_FILE`); the phone never sees either. A chat with no
  Hermes session gets one created through z0bridge (profile `DASH_LIVE_HERMES_PROFILE`).
- App: `app/src/store/live.ts`, `components/LiveSurface.tsx`, `LiveArtifactFrame(.web).tsx`.
  The fx0 document arrives already wrapped in fx0's embedded CSP. Web renders it in an
  `<iframe sandbox="allow-scripts" srcdoc>`; native in a WebView with navigation blocked. The
  document's only channel out is `postMessage({type: "fx-intent"})`, accepted only from that frame.

## Rules

- Hermes owns the conversation. The worker cannot exist without a Hermes session and never writes
  into its transcript; receipts go to a child record (`fxw_<worker>`) through Hermes's SessionDB.
- The worker never sends into a Hermes session a person holds open in a CLI/TUI; it says so instead.
- No fake activity: the dot by the worker line is gold only while a worker turn runs; timings
  shown (first char, html, turn) are measured on the phone.
