import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LiveArtifact } from "../../../shared/live";
import {
  applyLiveMessage,
  beginOpen,
  EMPTY_LIVE,
  liveOf,
  liveStore,
  setAskHermes,
  setLiveOpen,
  showVersion,
} from "./live";
import type { LiveState } from "./live";

const ALPHA = "dash2-147-alpha";
const BETA = "dash2-147-beta";

const artifact = (version: number): LiveArtifact => ({
  kind: "html",
  version,
  bytes: 8,
  sha256: `synthetic-${version}`,
  html: `<main>Version ${version}</main>`,
  createdAt: version,
});

// liveStore and the private open-request map are module singletons. Finish every
// request even if an assertion fails, without mocking imports or sharing timers.
const openRequests: string[] = [];
function trackedOpen(conversationId: string): string {
  const id = beginOpen(conversationId);
  openRequests.push(id);
  return id;
}

beforeEach(() => liveStore.set({}));
afterEach(() => {
  for (const id of openRequests) {
    applyLiveMessage({ type: "live_error", id, message: "Test teardown" });
  }
  openRequests.length = 0;
  liveStore.set({});
});

describe("Live surface open and version lifecycle", () => {
  test("missing conversations use EMPTY_LIVE without allocating or mutating it; open/close is scoped", () => {
    const fallback = EMPTY_LIVE;
    const originalLines = fallback.lines;
    const originalArtifacts = fallback.artifacts;
    expect(liveOf(undefined)).toBe(fallback);
    expect(liveOf("missing")).toBe(fallback);
    expect(liveStore.get()).toEqual({});

    setLiveOpen(ALPHA, true);
    expect(liveOf(ALPHA)).toMatchObject({ open: true, status: "idle" });
    expect(liveOf(ALPHA)).not.toBe(fallback);
    expect(liveOf(BETA)).toBe(fallback);

    setLiveOpen(BETA, true);
    const betaBeforeClose = liveOf(BETA);
    setLiveOpen(ALPHA, false);
    expect(liveOf(ALPHA)).toMatchObject({ open: false, status: "idle" });
    expect(liveOf(BETA)).toBe(betaBeforeClose);
    expect(liveOf(BETA).open).toBe(true);
    expect(liveStore.get()).not.toHaveProperty("missing");

    expect(EMPTY_LIVE).toEqual({
      open: false, status: "idle", lines: [], artifacts: [],
      controls: [], receipts: [], busy: false, askHermes: false,
    });
    expect(EMPTY_LIVE.lines).toBe(originalLines);
    expect(EMPTY_LIVE.artifacts).toBe(originalArtifacts);
    expect(liveOf(undefined)).toBe(fallback);
  });

  test("Ask Hermes and selected artifact version affect only the targeted conversation", () => {
    const alpha: LiveState = {
      ...EMPTY_LIVE, open: true, artifacts: [artifact(1), artifact(2)], shownVersion: 2,
    };
    const beta: LiveState = {
      ...EMPTY_LIVE, open: true, artifacts: [artifact(10)], shownVersion: 10,
    };
    liveStore.set({ [ALPHA]: alpha, [BETA]: beta });

    setAskHermes(ALPHA, true);
    showVersion(ALPHA, 1);
    expect(liveOf(ALPHA)).toMatchObject({ askHermes: true, shownVersion: 1 });
    expect(liveOf(ALPHA).artifacts).toEqual([artifact(1), artifact(2)]);
    expect(liveOf(BETA)).toBe(beta);

    setAskHermes(BETA, true);
    showVersion(BETA, 10);
    setAskHermes(ALPHA, false);
    expect(liveOf(ALPHA)).toMatchObject({ askHermes: false, shownVersion: 1 });
    expect(liveOf(BETA)).toMatchObject({ askHermes: true, shownVersion: 10 });

    setLiveOpen(ALPHA, false);
    expect(liveOf(ALPHA)).toMatchObject({ open: false, askHermes: false, shownVersion: 1 });
    expect(liveOf(BETA).open).toBe(true);
    expect(liveOf(BETA).artifacts).toEqual([artifact(10)]);
  });

  test("beginOpen clears the prior connection error but preserves surface content and the other chat", () => {
    const alpha: LiveState = {
      ...EMPTY_LIVE,
      open: false,
      status: "error",
      error: "Previous bridge failure",
      workerId: "old-worker",
      profileId: "old-profile",
      parentSessionId: "old-session",
      parentTitle: "Previous parent",
      model: "old-model",
      lines: [{ id: "prior-line", role: "worker", text: "Earlier output", state: "done" }],
      artifacts: [artifact(2)],
      shownVersion: 2,
      controls: [{ id: "confirm", kind: "confirm", prompt: "Continue?" }],
      receipts: [{ kind: "turn", summary: "Earlier work", decisions: [], artifacts: [], at: 1 }],
      askHermes: true,
      timing: { sentAt: 1, doneAt: 2 },
    };
    const beta: LiveState = {
      ...EMPTY_LIVE, open: true, status: "ready", workerId: "beta-worker",
      artifacts: [artifact(9)], shownVersion: 9,
    };
    liveStore.set({ [ALPHA]: alpha, [BETA]: beta });

    const id = trackedOpen(ALPHA);
    expect(id.length).toBeGreaterThan(0);
    const opening = liveOf(ALPHA);
    expect(opening.open).toBe(true);
    expect(opening.status).toBe("opening");
    expect(opening.error).toBeUndefined();
    expect(opening.lines).toBe(alpha.lines);
    expect(opening.artifacts).toBe(alpha.artifacts);
    expect(opening.shownVersion).toBe(2);
    expect(opening.controls).toBe(alpha.controls);
    expect(opening.receipts).toBe(alpha.receipts);
    expect(opening.askHermes).toBe(true);
    expect(opening.timing).toBe(alpha.timing);
    expect(liveOf(BETA)).toBe(beta);

    applyLiveMessage({
      type: "live_opened", id,
      workerId: "new-worker", profileId: "new-profile",
      parentSessionId: "new-session", parentTitle: "Current parent",
      model: "fx0", artifacts: [artifact(3), artifact(4)],
    });
    const ready = liveOf(ALPHA);
    expect(ready).toMatchObject({
      open: true, status: "ready", error: undefined,
      workerId: "new-worker", profileId: "new-profile",
      parentSessionId: "new-session", parentTitle: "Current parent",
      model: "fx0", shownVersion: 4,
    });
    expect(ready.artifacts).toEqual([artifact(3), artifact(4)]);
    expect(ready.lines).toBe(alpha.lines);
    expect(ready.controls).toBe(alpha.controls);
    expect(ready.receipts).toBe(alpha.receipts);
    expect(liveOf(BETA)).toBe(beta);
  });

  test("a failed open can retry without retaining its error or disturbing a ready peer", () => {
    setLiveOpen(BETA, true);
    const peer = liveOf(BETA);

    const failed = trackedOpen(ALPHA);
    applyLiveMessage({ type: "live_error", id: failed, message: "Bridge unavailable" });
    expect(liveOf(ALPHA)).toMatchObject({
      open: true, status: "error", error: "Bridge unavailable",
    });
    expect(liveOf(BETA)).toBe(peer);

    const retry = trackedOpen(ALPHA);
    expect(liveOf(ALPHA)).toMatchObject({ open: true, status: "opening", error: undefined });
    expect(liveOf(BETA)).toBe(peer);
    applyLiveMessage({
      type: "live_opened", id: retry,
      workerId: "retry-worker", profileId: "retry-profile",
      parentSessionId: "retry-session", artifacts: [artifact(5)],
    });
    expect(liveOf(ALPHA)).toMatchObject({
      open: true, status: "ready", error: undefined,
      workerId: "retry-worker", shownVersion: 5,
    });
    expect(liveOf(ALPHA).artifacts).toEqual([artifact(5)]);
    expect(liveOf(BETA)).toBe(peer);
  });
});
