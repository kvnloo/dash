# Bots page (prototype)

Status: COVERED — `e2e/mbp-army/bots-page.spec.ts` (feature `bots-page-prototype`). Requirements: `docs/bots-page/REQUIREMENTS.md`.

- `bots-page-table` [COVERED]: every bot the host reports is one element-style gem (number, symbol, name, state).
- `bots-page-orrery` [COVERED]: one orrery per host, bots as planets on static rings.
- `bots-page-tree` [COVERED]: the Tree view is the shared host > harness > profile tree.
- `bots-page-bot` [COVERED]: a gem opens the simple bot page; channels show honest state; only a bot whose harness the host lists offers "Chat with <name>", which opens a chat.

How to get there (user POV): Settings > Bots page (prototype), or `exp://<metro>/--/botspage`.

The journey writes real Hermes profile configs into the fixture `HERMES_HOME` (`config.yaml` with `platforms.telegram/discord`, `profiles/courier/config.yaml` with `gateway.platforms.slack`), waits for the bridge `/roster` to report both bots, then pairs. No gateway runs, so every channel reads "Not running".

Drive: `army-stack.sh drive <run> 1 e2e/mbp-army/bots-page.spec.ts`. Native look (S25 density, BotFace motion on device) is not proven by the web army.
