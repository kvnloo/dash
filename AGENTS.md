# Dash: notes for agents and contributors

Dash is a phone app (Expo, Android + iOS) that chats with free-tier models in
parallel and with the coding agents on your own computer over Tailscale.

## Layout

- `app/` Expo app. All UI lives in `app/src`.
- `bridge/` Bun WebSocket server that runs agent CLIs (omp, codex, grok, claude, hermes) on the computer. Entry: `bridge/index.ts`, adapters in `bridge/src/harnesses.ts`.
- `shared/protocol.ts` wire protocol between the two. Dependency-free; both sides import it.

## Ownership while several agents work at once

Several agents build this repo concurrently. To avoid clobbering each other:

- `app/src/**`, `app/App.tsx`, `app/app.json`, `app/metro.config.js`: owned by the UI session (the one that wrote this file).
- `bridge/**`, `shared/protocol.ts`: owned by the bridge session. The UI session only reads them.
- Anyone adding an app dependency: run `bunx expo install <pkg>` from `app/`, never edit `package.json` by hand, and keep the app runnable in Expo Go (no native modules outside the Expo SDK).

If you need a protocol change, add it to `shared/protocol.ts` with a parser update and keep old fields working.

## Conventions

- TypeScript strict. `unknown` at boundaries, parsed into named types. No `as` casts, no `any`.
- No new dependencies for things under 100 lines.
- Pure black UI, system font, one accent. Match the existing components before adding new ones.
- Streaming text goes through `app/src/store/text.ts` (per-reply subscriptions, rAF-coalesced). Never put per-token updates in the chats store.
