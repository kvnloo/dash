# Round 3: round 1's instruments, made readable

Round 3 is the default build (`out/*.html`). Round 1 is kept as `out/*-r1.html`, round 2 as `out/*-r2.html`.

Owner feedback it answers: round 1 was detailed but colourful, compressed and hard to act on; round 2 lost the diagrams and hid everything behind expanders.

## What changed

- Starts from round 1. The number strip, timeline, per-worker lanes and stats charts are back and visible on load. Nothing important sits behind an expander. The only toggle shows finished work older than 12 h.
- Colour. One neutral base and three accents: amber for needs you, red for failing, cut or stalled, blue for live. Phases are no longer coloured. Tool calls render as grey density columns in 4 px buckets. Failed calls are 3 px marks on an 8 px grid above the bar, so neighbouring marks never blur together.
- Phone. The timeline has a fixed label column (30 % at 412 px) and a horizontally scrolling plot (96 px/h minimum, 260 px/h in lanes). It zooms with pinch, ctrl-wheel or fit/2×/4×, and opens scrolled to "now". Rows are 44 px or taller. Pocket (D) uses a vertical time axis instead (see below).
- Labels. Rows show project and goal, for example `NOOP · ring tap`, `z0live · relay`, `Phone · S25`, `Sim · ACE`, `Dash · trace prototypes`. They come from an ordered goal-keyword allowlist, `export_trace.LABEL_RULES`. Round 2 preferred transcript paths, which mislabelled workers that only visited another repo. Run ids appear only as small worker references in tables.
- Ephemeral. Rows are grouped Live / Last 3 hours / Earlier today. Earlier rows are dimmed to 42 %. Finished work older than 12 h drops out. Unresumed cuts stay until someone deals with them.
- Interpretation. Each view has one READ strip of 2-3 lines with real numbers, plus up to 3 action chips. Every chip names its outcome: Dash as control plane, Ring to z0live, Integration debt or Burn on pace. Inline annotations appear only for live, cut, resumed, asks or stalls of 10 min or more. `data/interpretations-r3.json` replaces the generic R2 cache. `build_r3.py` recomputes its `checks` from the data and fails the build on any mismatch.
- Working together. Each chip has Do / Not now / ?. "?" opens one inline field. Responses go to localStorage and can be exported as JSON. The R2 endpoint contract is unchanged: `dash.trace.feedback/v1` POST, endpoint key `dash.trace.feedback.endpoint.v1`, settable with `?feedback_endpoint=`.

## Horizontal vs vertical time axis on a phone

- Horizontal scroll (A trace, B lanes): keeps concurrency, cut moments and handoffs visible as geometry, which is the point of those views. The cost is that you see about 2.5 h at a time at 96 px/h.
- Vertical (D pocket): newest first, one line per worker start or end, so labels can be full width. Hours older than 3 h fold into one dimmed line with a 10-minute density strip. This reads best when the question is "what changed", but it loses overlap.

## Build and verify

    python3 -P tools/prepare_r3.py   # relabel from delegation logs (read-only) -> data/trace-r3.json, data/facts-r3.json
    python3 -P tools/build_r3.py     # offline; checks the cached read against the data
    python3 -P tools/shot_r3.py      # private headless Chromium -> captures/r3/*.png + verification.json

`shot_r3.py` launches its own headless Chromium and never attaches to an existing browser.
