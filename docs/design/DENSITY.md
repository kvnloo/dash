# Density: layout and information

Two independent axes, one context (`components/Density.tsx`, reducer in `lib/density.ts`).

- **Layout density**: Compact / Comfortable / Spacious. Spacing, row height, padding only.
- **Information density**: L1 to L5. How much *data* each visualisation draws. A continuous dial,
  snapped to five levels (`toInfoLevel`).

Changing one never changes the other. Components read `useDensity()` and ask
`shows(component, part, info)` from `lib/info-levels.ts`; they never compare levels by hand.

## Layout tokens

| Token | Compact | Comfortable | Spacious | Spacious ÷ Comfortable |
|---|---|---|---|---|
| rowMin | 44 | 60 | 72 | 1.20 |
| tileMin | 100 | 136 | 164 | 1.21 |
| padding | 8 | 12 | 15 | 1.25 |
| plotMin | 44 | 68 | 84 | 1.24 |
| gap | 4 | 8 | 10 | 1.25 |

Spacious replaces Rich (84 / 176 / 18 / 100 / 12, up to 1.5× Comfortable). The cap is pinned by
`density.test.ts` ("Spacious stays within 1.25x Comfortable"). Stored `"rich"` values migrate to
`"spacious"` on read.

## Information levels per component

Levels are cumulative: each level adds parts and removes none. L5 hides nothing; L1 is the one
fact that matters. The table is the code: `INFO_CONTRACTS` + `FIRST` in `lib/info-levels.ts`,
pinned by `info-levels.test.ts`.

| Component | L1 | L2 adds | L3 adds | L4 adds | L5 adds |
|---|---|---|---|---|---|
| Trace timeline (the profiler) | one thin line per run, project name | goal label | full bars with call-density ticks | time axis + zoom, ×workers, cut/ask counts | stalls, failed-call marks, end notes (model, outcome) |
| Stat tile | value | delta / sub ("of 9", "2 resumed") | chart (sparkline or dot meter) | range or share ("range 0–7", "40% resumed") | breakdown (each segment's count, sample count, Segment hint) |
| READ strip | first sentence | whole read | numbers set in tabular mono | READ tag | (all parts shown) |
| Action chip | title | outcome pill | why | swipe hint | inline Do / Not now buttons, why unclamped |
| Orchestra node | glyph | label | state ring + live orb, graph legend | state caption ("idle", "needs you") | path tail |
| Tool row (contract, for chat tool rows) | name | status | args | duration | output |
| Zero card | name, phase orb, trace sub-card | current step, elapsed | agents · chats | host · path | last activity age |
| Trace sub-card (inside Zero) | phase, current step | elapsed | live / cut / ask | workers · model | the READ text |

Notes:

- Orchestra nodes have no age or cost on the wire today (`MapNode` carries label, kind, state,
  path). L4/L5 show a state caption and the path tail instead; when the bridge reports cost it slots in at L5.
- The tool row contract is declared for chat tool rows; chat's Thinking & tools Hide/Compact/Full
  still controls reply detail and is a page row in the same menu.

## Persistence

`DensityPrefs = { global, screens }`, stored at AsyncStorage `dash.density.v1`. Keys in `screens`
are screen ids (`orchestra`, `trace`, `lab`, `bots`, `chats`, `chat`) or `chat:<id>`. Resolution
per axis: chat override, then screen override, then global. A write from the menu lands on the
current scope (chat override inside a chat, screen override elsewhere). The Lab pins levels with
`<DensityScope fixedInfo>` without writing prefs.

## Where the controls live

One settings registry (`lib/settings-registry.ts`) feeds both menus:

- **Composer filter menu** (sliders button beside @ on the Dash bar; leading edge of the chat
  composer; floating on Trace and Lab): Info density and Layout first, then the page's own rows
  registered with `usePageControls(screenId, rows)`. These are the frequently scrubbed controls.
- **Header display menu** (#103): rare settings only (`HEADER_ROW_IDS`: thinking summaries,
  thumb side, large type). It renders `rowsFor("header", …)` from the same registry.

Page rows today: Orchestra (View scrub, Show All/Focus, Highlight legend scrub, Reset, Approvals
action), chat (Thinking & tools Hide/Compact/Full). Bots and Chats have no toolbar controls of
their own; they get the two axes.
