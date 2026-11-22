# Trace screen

From **Orchestra → Agent trace**, the live bridge feed opens as a vertical activity timeline grouped by status/recency. Open a row for its intent contract, validation receipts and artifacts. Hermes detail defaults to the newest recorded turn; use Older turn / Newer turn to inspect previous requests and their own output. Use Show time chart to switch to the zoomable plot.

Status: Covered by the trace evidence journey and the live/unavailable feed journeys.

## Driving it with the tester army

- `e2e/mbp-army/army.spec.ts` › "Trace opens a readable timeline and shows the right evidence for each turn"
- `e2e/mbp-army/live-priorities.spec.ts` › "Agent Trace loads the bridge live session and clears it on unavailable" and "Agent Trace reports unavailable when the live bridge has no source observations"

The evidence journey reads fixture files and SQLite history through the real authenticated bridge, asserts sub-second evidence display, opens a receipt and an artifact, and verifies that evidence does not cross turn boundaries. The chart toggle is covered; individual chart gestures, row menus, and action-chip interactions remain uncovered here.
