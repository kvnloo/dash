import { describe, expect, test } from "bun:test";
import { createPaneState, reducePane } from "./visual-pane";
import type { PaneEvent, PaneState } from "./visual-pane";

function apply(state: PaneState, event: PaneEvent): PaneState {
  return reducePane(state, event).state;
}

describe("Brainstorm visual-pane reducer", () => {
  test("commit emits a loader; the first OpenUI chunk marks first_node exactly once", () => {
    const initial = createPaneState();
    expect(initial).toEqual({
      generation: 0, turnEnded: false, content: { kind: "empty" },
      dimmed: false, pendingArtifact: null,
    });

    const started = reducePane(initial, { type: "turn-commit", generation: 1 });
    expect(started.trace).toEqual(["genui.loader"]);
    expect(started.state).toEqual({
      generation: 1,
      turnEnded: false,
      content: { kind: "loader", generation: 1 },
      dimmed: false,
      pendingArtifact: null,
    });

    const duplicateCommit = reducePane(started.state, { type: "turn-commit", generation: 1 });
    expect(duplicateCommit.state).toBe(started.state);
    expect(duplicateCommit.trace).toEqual([]);

    const first = reducePane(started.state, {
      type: "genui", generation: 1, status: "loading", source: 'root = Roadmap("dash-',
    });
    expect(first.trace).toEqual(["genui.first_node"]);
    expect(first.state.content).toEqual({
      kind: "genui", generation: 1, status: "loading", source: 'root = Roadmap("dash-',
    });

    const ready = reducePane(first.state, {
      type: "genui", generation: 1, status: "ready", source: 'root = Roadmap("dash-roadmap")',
    });
    expect(ready.trace).toEqual([]);
    expect(ready.state.content).toEqual({
      kind: "genui", generation: 1, status: "ready",
      source: 'root = Roadmap("dash-roadmap")',
    });

    const duplicate = reducePane(ready.state, {
      type: "genui", generation: 1, status: "ready", source: 'root = Roadmap("dash-roadmap")',
    });
    expect(duplicate.state).toBe(ready.state);
    expect(duplicate.trace).toEqual([]);
  });

  test("invalid OpenUI is a typed invalid state with no raw payload", () => {
    const started = apply(createPaneState(), { type: "turn-commit", generation: 4 });
    const broken = reducePane(started, {
      type: "genui", generation: 4, status: "invalid",
      source: "<script>unsafe</script> or a markdown code fence",
    });
    expect(broken.trace).toEqual(["genui.first_node"]);
    expect(broken.state.content).toEqual({
      kind: "genui", generation: 4, status: "invalid", source: "",
    });
    const sameInvalid = reducePane(broken.state, {
      type: "genui", generation: 4, status: "invalid", source: "some other invalid input",
    });
    expect(sameInvalid.state).toBe(broken.state);
    expect(sameInvalid.trace).toEqual([]);
  });

  test("every stale event is discarded without changing the state object", () => {
    let state = apply(createPaneState(), { type: "turn-commit", generation: 1 });
    state = apply(state, {
      type: "genui", generation: 1, status: "ready", source: "first",
    });
    state = apply(state, { type: "turn-commit", generation: 2 });
    const staleEvents: PaneEvent[] = [
      { type: "turn-commit", generation: 1 },
      { type: "gen-bump", generation: 1 },
      { type: "genui", generation: 1, status: "ready", source: "old render" },
      { type: "artifact-ready", generation: 1, html: "<p>old</p>" },
      { type: "turn-end", generation: 1 },
      { type: "figure", generation: 1, figureId: "old-figure" },
    ];

    for (const event of staleEvents) {
      const result = reducePane(state, event);
      expect(result.state).toBe(state);
      expect(result.trace).toEqual(["genui.discard"]);
      expect(result.state.content).toEqual({ kind: "loader", generation: 2 });
    }
  });

  test("background HTML waits until turn-end, then supersedes the stream", () => {
    const started = apply(createPaneState(), { type: "turn-commit", generation: 1 });
    const streaming = apply(started, {
      type: "genui", generation: 1, status: "ready", source: "OpenUI result",
    });
    const waiting = reducePane(streaming, {
      type: "artifact-ready", generation: 1, html: "<main>Complete</main>",
    });
    expect(waiting.trace).toEqual([]);
    expect(waiting.state.content).toBe(streaming.content);
    expect(waiting.state.turnEnded).toBe(false);
    expect(waiting.state.pendingArtifact).toEqual({
      generation: 1, html: "<main>Complete</main>",
    });
    const duplicate = reducePane(waiting.state, {
      type: "artifact-ready", generation: 1, html: "<main>Complete</main>",
    });
    expect(duplicate.state).toBe(waiting.state);

    const ended = reducePane(waiting.state, { type: "turn-end", generation: 1 });
    expect(ended.state).toEqual({
      generation: 1, turnEnded: true,
      content: { kind: "artifact", generation: 1, html: "<main>Complete</main>" },
      dimmed: false, pendingArtifact: null,
    });
    const redundantEnd = reducePane(ended.state, { type: "turn-end", generation: 1 });
    expect(redundantEnd.state).toBe(ended.state);

    const lateGenui = reducePane(ended.state, {
      type: "genui", generation: 1, status: "ready", source: "late chunk",
    });
    expect(lateGenui.state).toBe(ended.state);
    expect(lateGenui.trace).toEqual([]);

    const updatedArtifact = reducePane(ended.state, {
      type: "artifact-ready", generation: 1, html: "<main>Revised</main>",
    });
    expect(updatedArtifact.state.content).toEqual({
      kind: "artifact", generation: 1, html: "<main>Revised</main>",
    });
    expect(updatedArtifact.state.pendingArtifact).toBeNull();
    expect(updatedArtifact.state.turnEnded).toBe(true);
  });

  test("an artifact arriving after the turn already ended is shown immediately", () => {
    const started = apply(createPaneState(), { type: "turn-commit", generation: 3 });
    const ended = apply(started, { type: "turn-end", generation: 3 });
    expect(ended.content).toEqual({ kind: "loader", generation: 3 });
    const immediate = reducePane(ended, {
      type: "artifact-ready", generation: 3, html: "<p>finished</p>",
    });
    expect(immediate.state.content).toEqual({
      kind: "artifact", generation: 3, html: "<p>finished</p>",
    });
    expect(immediate.state.turnEnded).toBe(true);
    expect(immediate.state.pendingArtifact).toBeNull();
    const identical = reducePane(immediate.state, {
      type: "artifact-ready", generation: 3, html: "<p>finished</p>",
    });
    expect(identical.state).toBe(immediate.state);
  });

  test("gen-bump dims immediately, retains only the old pixels, and clears old turn metadata", () => {
    let state = apply(createPaneState(), { type: "turn-commit", generation: 1 });
    state = apply(state, {
      type: "genui", generation: 1, status: "ready", source: "old stream",
    });
    state = apply(state, {
      type: "artifact-ready", generation: 1, html: "<p>old pending</p>",
    });
    const content = state.content;
    const bumped = reducePane(state, { type: "gen-bump", generation: 2 });
    expect(bumped.trace).toEqual([]);
    expect(bumped.state.generation).toBe(2);
    expect(bumped.state.dimmed).toBe(true);
    expect(bumped.state.content).toBe(content);
    expect(bumped.state.turnEnded).toBe(false);
    expect(bumped.state.pendingArtifact).toBeNull();

    const redundant = reducePane(bumped.state, { type: "gen-bump", generation: 2 });
    expect(redundant.state).toBe(bumped.state);
    const staleReady = reducePane(bumped.state, {
      type: "artifact-ready", generation: 1, html: "<p>obsolete</p>",
    });
    expect(staleReady.state).toBe(bumped.state);
    expect(staleReady.trace).toEqual(["genui.discard"]);

    const committed = reducePane(bumped.state, { type: "turn-commit", generation: 2 });
    expect(committed.trace).toEqual(["genui.loader"]);
    expect(committed.state.content).toEqual({ kind: "loader", generation: 2 });
    expect(committed.state.dimmed).toBe(false);
  });

  test("cached figure fills a loader, OpenUI supersedes it, and an active stream wins", () => {
    const started = apply(createPaneState(), { type: "turn-commit", generation: 7 });
    const figure = reducePane(started, {
      type: "figure", generation: 7, figureId: "dial-indicator",
    });
    expect(figure.state.content).toEqual({
      kind: "figure", generation: 7, figureId: "dial-indicator",
    });
    const sameFigure = reducePane(figure.state, {
      type: "figure", generation: 7, figureId: "dial-indicator",
    });
    expect(sameFigure.state).toBe(figure.state);

    const streamed = reducePane(figure.state, {
      type: "genui", generation: 7, status: "loading", source: "partial OpenUI",
    });
    expect(streamed.trace).toEqual(["genui.first_node"]);
    const cannotDisplaceStream = reducePane(streamed.state, {
      type: "figure", generation: 7, figureId: "test-rig",
    });
    expect(cannotDisplaceStream.state).toBe(streamed.state);

    const ready = reducePane(streamed.state, {
      type: "genui", generation: 7, status: "ready", source: "complete OpenUI",
    });
    expect(ready.trace).toEqual([]);
    const cannotDisplaceReady = reducePane(ready.state, {
      type: "figure", generation: 7, figureId: "test-rig",
    });
    expect(cannotDisplaceReady.state).toBe(ready.state);
    const bumped = apply(ready.state, { type: "gen-bump", generation: 8 });
    const newFigure = apply(bumped, {
      type: "figure", generation: 8, figureId: "test-rig",
    });
    expect(newFigure.content).toEqual({
      kind: "figure", generation: 8, figureId: "test-rig",
    });
    expect(newFigure.dimmed).toBe(false);
  });

  test("an uncommitted newer artifact cannot borrow the older turn's ended flag", () => {
    const started = apply(createPaneState(), { type: "turn-commit", generation: 1 });
    const finished = apply(started, { type: "turn-end", generation: 1 });
    const newPending = reducePane(finished, {
      type: "artifact-ready", generation: 2, html: "<p>future</p>",
    });
    expect(newPending.state.generation).toBe(2);
    expect(newPending.state.turnEnded).toBe(false);
    expect(newPending.state.dimmed).toBe(true);
    expect(newPending.state.content).toBe(finished.content);
    expect(newPending.state.pendingArtifact).toEqual({
      generation: 2, html: "<p>future</p>",
    });

    const oldEnd = reducePane(newPending.state, { type: "turn-end", generation: 1 });
    expect(oldEnd.state).toBe(newPending.state);
    expect(oldEnd.trace).toEqual(["genui.discard"]);
    const ended = reducePane(newPending.state, { type: "turn-end", generation: 2 });
    expect(ended.state.turnEnded).toBe(true);
    expect(ended.state.dimmed).toBe(false);
    expect(ended.state.content).toEqual({
      kind: "artifact", generation: 2, html: "<p>future</p>",
    });
  });

  test("malformed numeric generations never corrupt monotonic state", () => {
    const state = apply(createPaneState(), { type: "turn-commit", generation: 5 });
    const events: PaneEvent[] = [
      { type: "turn-commit", generation: Number.NaN },
      { type: "gen-bump", generation: Infinity },
      { type: "genui", generation: -1, status: "ready", source: "invalid" },
      { type: "artifact-ready", generation: 0.5, html: "<p>invalid</p>" },
      { type: "turn-end", generation: Number.MAX_SAFE_INTEGER + 1 },
      { type: "figure", generation: -Infinity, figureId: "invalid" },
    ];
    for (const event of events) {
      const result = reducePane(state, event);
      expect(result.state).toBe(state);
      expect(result.trace).toEqual(["genui.discard"]);
    }
  });

  test("exhaustive four-event sequences cannot reach raw/code kinds or regress a generation", () => {
    const events: PaneEvent[] = [
      { type: "turn-commit", generation: 1 },
      { type: "genui", generation: 1, status: "loading", source: "partial" },
      { type: "genui", generation: 1, status: "ready", source: "complete" },
      { type: "genui", generation: 1, status: "invalid", source: "raw source" },
      { type: "artifact-ready", generation: 1, html: "<p>one</p>" },
      { type: "turn-end", generation: 1 },
      { type: "figure", generation: 1, figureId: "one" },
      { type: "gen-bump", generation: 2 },
      { type: "turn-commit", generation: 2 },
      { type: "genui", generation: 2, status: "ready", source: "two" },
      { type: "artifact-ready", generation: 2, html: "<p>two</p>" },
      { type: "turn-end", generation: 2 },
      { type: "figure", generation: 2, figureId: "two" },
    ];
    const safeKinds = new Set(["empty", "loader", "genui", "artifact", "figure"]);

    function visit(state: PaneState, remaining: number): void {
      if (remaining === 0) return;
      for (const event of events) {
        const result = reducePane(state, event);
        expect(safeKinds.has(result.state.content.kind)).toBe(true);
        expect(result.state.content.kind).not.toBe("code");
        expect(result.state.content.kind).not.toBe("raw");
        expect(result.state.generation).toBeGreaterThanOrEqual(state.generation);
        if (result.state.content.kind === "genui" &&
            result.state.content.status === "invalid") {
          expect(result.state.content.source).toBe("");
        }
        if (result.state.content.kind === "artifact") {
          expect(result.state.turnEnded).toBe(true);
        }
        visit(result.state, remaining - 1);
      }
    }

    visit(createPaneState(), 4);
  });
});
