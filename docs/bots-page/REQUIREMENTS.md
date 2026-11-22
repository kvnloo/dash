# Bots page: requirements (DA-073)

What Kevin has asked for on the Dash Bots page, in one place, with the prototype status for each.
Prototype: `app/src/screens/BotsPageScreen.tsx` (model `app/src/lib/bots-page.ts`), army journey
`e2e/mbp-army/bots-page.spec.ts` (feature `bots-page-prototype`).

Open it: Settings > **Bots page (prototype)**, or the deep link `exp://<metro>/--/botspage`
(`dash://botspage` in a dev build).

## Kevin's words

Verbatim, with where each was recorded. Nothing here is paraphrased. Q1 and Q2 are Kevin's own
ledger words. Q3 to Q6 were filed from the kvnloo GitHub account (issue and PR text, possibly written
by an agent for him); Q6 is a PR's summary of his feedback.

| # | Quote | Source |
|---|-------|--------|
| Q1 | "Dash bots page: gather all Kevin requirements; grok-bot-simple page + host/harness/profile tree; orrery/table gem look (elementalui); use dreamloop + his forked UI skills + taste repo" | Owner ledger `req/dash.jsonl`, row DA-073 |
| Q2 | "i just literally want to USE THE APP" | Owner goal for the Dash ledger lanes |
| Q3 | "Grok Bot already makes it cheap to spin up hundreds of bots. Hermes already provides the infra to run that fleet. Dash is the phone-shaped UI that does the same thing **across every harness**" | Issue #15 (Ethos), kvnloo account |
| Q4 | "Bots pane can start work on grok-bot **and** Hermes without a paid ChatGPT/Claude seat" | Issue #15, acceptance list |
| Q5 | "Roster is live: grok-bot, Hermes profiles, OMP daemons, Tailscale peers. Empty hosts stay empty. Do not fake Cursor agents." | Issue #15 |
| Q6 | "fix the Bots page vocabulary, grouping and density" | PR #73 body, summarising owner feedback on the Living Night build |

Owner chat messages behind spec rows DF-110 and DF-112 (`hermes/clean:msg184990`, source ids H-024,
H-025, H-095) are not reachable from this sandbox, so they are cited by their spec text below,
not quoted.

## Recorded requirements (spec and design authority)

- **DF-110** (P0, recurring): "Bots groups by collapsible host; harness, bot/profile, host and session
  are distinct terms; no repeated unrelated icons." (`spec/SPEC.md`)
- **DF-112**: every hierarchy reuses the shared `Tree` component.
- **DF-113** (P0, recurring): keep DESIGN.md (OLED black, cream ink, gold accent, glass, 44 dp targets);
  no restyle or theme module.
- **Glossary** (`docs/design/language.md`): a bot is a deployed messaging identity (a Hermes gateway
  profile on Telegram/Discord, OpenDots, GrokBot); not a harness, not a session.
- **#47**: bot animation from synergy.ai: Reanimated only, transforms/opacity, under 300 ms,
  `ReduceMotion.System`, no gold glow. Landed as `BotFace` (Moodie faces).
- **#55**: Bots DESIGN.md audit. Hardcoded colours, 44 px hits, press scales 0.985/0.92/0.9, semantic
  status dots (not gold "running" badges), honest unavailable/empty styling, no emoji icons.

## Requirements and prototype status

| Id | Requirement | From | Prototype |
|----|-------------|------|-----------|
| R1 | A Bots page that lists every bot the hosts report, and only those | Q1, Q5 | Done. `botGems` reads `HostInfo.bots`; phones skipped; empty and "does not report" hosts say so |
| R2 | Simple per-bot page (grok-bot-simple): face, name, where it runs, channels, its chats, one action | Q1 | Done. Tap a gem: the same face as in the Hosts tree, symbol, family · host, channel rows with state words, the bot's chats |
| R3 | Chat with a bot from its page, Hermes and Grok alike | Q2, Q4 | Done where the bridge allows it. "Chat with <bot>" shows only when the app's own target check passes; otherwise the page shows the bridge's reason (for example, this bridge starts new chats on the default Hermes profile only). The bot's existing chats always open |
| R4 | Host > harness > profile tree on the same page | Q1, DF-110, DF-112 | Done. **Tree** view reuses `hostsTree` + `Tree`; #638 (DA-045, one level per kind) will flow in unchanged |
| R5 | "Table gem" look: bots as element tiles (number, two-letter symbol, name, state) | Q1 | Done. Unique element symbols (`gemSymbol`), identity colour as a facet edge, semantic status dot |
| R6 | "Orrery" look: bots orbiting their host | Q1 | Done, static. Host is the sun, bots sit on one or two rings |
| R7 | Correct vocabulary; host, harness, bot, session never mixed | DF-110, glossary | Done. Family labels "Hermes profile", "Grok", "Service" |
| R8 | DESIGN.md: black, cream, gold only for selection, 44 px targets, press scales, semantic status | DF-113, #55 | Done. Gold only on the selected view tab; status uses ok/warn/danger/faint |
| R9 | Motion per #47 / MOTION.md, reduced motion respected | #47 | Done. Only `BotFace` ambient motion (pauses off-screen and on reduced motion) |
| R10 | Honest state: no invented counts, channels or live claims | Q5, taste "never" rules | Done. "Not running" when only configured; "Host offline" wins |
| R11 | Use Kevin's dream-loop method, forked UI skills and taste-skill | Q1 | Partly. Taste and dream-loop rules applied below; owner gate is the S25 look (not done here) |
| R12 | Viewed on the S25 from the preview Metro :8098 | DA-073 done check | Not done here: needs device (see the PR's REPORT) |

## How the skills were applied

- **taste-skill** (kvnloo/taste-skill): one card style and one radius scale (`radius.card` gems,
  `radius.pill` planets); buttons are a verb and an object ("Chat with default"); every control named
  (gems and planets carry "name on host, state"); no fade-in per tile; no invented figures.
- **dream-loop** (kvnloo/dream-loop): target and intent locked here first; one hypothesis per view;
  real output inspected (army screenshots `bots-table.png`, `bots-orrery.png`, `bots-tree.png`,
  `bot-page-*.png`); the owner gate (Kevin's look on the S25) decides, not the screenshots.
- **affectui** (kvnloo/affectui, "agent trees"): informs the tree view; Dash keeps its own `Tree`
  component per DF-112, nothing is copied.

## Open questions for Kevin

1. **elementalui** and **grok-bot-simple** are not public under kvnloo, so the gem table and the simple
   page follow the words in Q1, not a reference. Share either repo or a screenshot to match it closer.
2. **Orrery motion.** MOTION.md caps travel at 180 ms, so the planets do not revolve. A slow ambient
   revolution would need an owner exception to MOTION.md.
3. **Where it lives.** The prototype is a screen behind Settings. Promote it to the first Main tab
   (replacing or beside Hosts) once you approve the look.
