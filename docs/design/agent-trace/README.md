# Agent trace for Dash: four prototypes (design brainstorm)

Round 3 is the default build and served view; see [ROUND3.md](ROUND3.md). Round 2 is kept as `out/*-r2.html` (see [ROUND2.md](ROUND2.md)) and round 1 as `out/*-r1.html`.

The remainder of this document records round 1; its synthetic-label descriptions and default UI behavior are historical, not the current R2 contract.

Status: draft prototypes for discussion, 2026-10-21. Not wired into the app. Nothing here
changes Dash's chat or navigation.

Open them in Dash through the artifact-stage review link (the "Open in stage" pill), or open
`out/*.html` in any browser. Each file is self-contained (fonts and data inlined) because the
stage frames it in a cross-site iframe.

| File | Bet | Question it answers |
| --- | --- | --- |
| `out/index.html` | Brief | What are the four bets and what do we need to decide? |
| `out/a-trace.html` | A · Event trace | What exactly happened, and where did it go wrong? |
| `out/b-lanes.html` | B · Run replay with state bands | Who did what, when, and who never came back? |
| `out/c-stats.html` | C · Stats | Is the system healthy, on budget, and what is blocking it? |
| `out/d-pocket.html` | D · Pocket (phone-first) | Do I need to do anything right now? |

## Data

`data/trace-20261020.json` (`dash.agent-trace.proto/v0`) is exported by
`tools/export_trace.py` from, read-only:

- Hermes delegation live logs (manifest + task transcript per worker): tool name, start,
  duration, ok/error; final status; interruption time.
- Hermes `state.db`: per-subagent tokens and estimated cost; timestamps of the owner's
  messages in the orchestrator sessions (time and kind only).
- A read-only copy of omp `stats.db`: per-model requests/tokens/cost and per-tool counts, 7 days.
- `burn-pace --json`: weekly quota, hours to reset, pace ratio per lane.

Privacy: counts, durations, tool names and synthetic worker labels (`<area> <letter>`) only.
No goals, prompts, arguments, outputs or summaries leave the exporter. Phases (explore,
implement, verify, pr), stalls, needs-you categories and resume links are heuristics run
locally; each is named in the file's `heuristics` block and in the UI footers.

States use the z0intelligence FSM vocabulary (worker supervision, loop 2: Dispatched, Running,
Stalled, Interrupted, Resumed, Completed; work item, loop 1: Verifying, DraftPR). Verifying
and DraftPR are read from tool calls, so they are estimates until the FSM emits real events.

## What we learned

From omp's stats and trace (source `packages/stats` @ 0e2411c0df, and the running `omp stats`
on a read-only copy of stats.db):

- Every page states its purpose in one sentence, then a strip of numbers that split a whole
  (wall = model + tool + idle, each with "% of wall").
- Defaults do the editing: idle gaps compressed, deep tracks collapsed, 24h preselected.
- One selection drives canvas, transcript and drawer; the keyboard contract is printed under
  the chart (W/S zoom, A/D pan, 0 fit, F focus, Esc).
- Mono tabular numbers, one meaning per colour, failures as a badge in a column.
- Honest method labels (frustration says regex vs judge).

From Arc's AgentTimeline (public preview, captured in an isolated headless Sway session and
measured; reference only, nothing copied):

- One clock drives bars, playhead and connectors; the live span has a square leading edge;
  connectors draw in about 350 ms; pinning dims everything off-path to 0.28; reduced motion
  starts finished; the status line settles into a one-line summary.
- It never shows what matters most for us: hours-long runs, interruptions, stalls, quota
  pace and items waiting on a person.

## Briefs

### A · Event trace
- Emphasises: every tool call on one canvas coloured by phase; failures, stalls, compressed
  idle; keyboard stepping (J/K, E next error, X next stall); sortable workers and tools with cost.
- Hides: replay and motion; runs start folded to one row each.
- Open questions: day or latest run as the default? Errors and stalls on by default? Should
  Dash ever show transcript text (local only)?

### B · Run replay with state bands
- Emphasises: one run, Hermes on top, a row per worker; dispatch/report elbows; interrupted
  ends in a cross; an FSM band under each row; 60x to 960x replay, scrub, pin to dim.
- Hides: individual calls inside a span; other runs; per-call tokens (totals spread by calls).
- Open questions: replay after the fact or only live? Draw a bridge from a cut worker to its
  resume? Do steering messages belong on the Hermes row?

### C · Stats
- Emphasises: three headline numbers (Opus pace, workers cut, items waiting on you); burn vs
  even pace per lane; roles from ROLES-v0 with "no source" where data is missing; ranked
  bottlenecks with evidence.
- Hides: individual runs and calls; frustration (needs message text, off by design).
- Open questions: which bottleneck should Kerdoios act on by itself? Does "verified" mean
  tests ran or a checker agreed? Add deep-work blocks to the attention chart?

### D · Pocket
- Emphasises: live workers with state and quiet time; Needs you batched by kind of decision;
  a dot per worker for the day; one-thumb dock; a bottom sheet per worker.
- Hides: timelines, tables, tool names except the last; controls are shown but disabled.
- Open questions: Dash home tab or pull-down? Which of Steer, Stop, Resume first? Quiet-time
  alarm or a per-task deadline?

## Rebuild

```sh
python3 tools/export_trace.py data/trace-20261020.json <copy-of-omp-stats.db>   # on the host with the logs
python3 tools/build.py                                                          # writes out/*.html
python3 -P tools/shot.py captures out/a-trace.html both                         # needs a CDP browser; set TRACE_CDP_URL
```

Fonts: Hanken Grotesk, IBM Plex Mono, Cormorant Garamond (OFL-1.1, @fontsource 5.3.0); licences
in `fonts/`. Colours: zerOS Living Night as ported in `app/src/theme.ts`.
