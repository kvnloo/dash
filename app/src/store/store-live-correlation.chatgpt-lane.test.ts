import { afterEach, describe, expect, test } from "bun:test";
import type { LiveArtifact, LiveControl, LiveEvent, LiveReceipt, LiveServerMessage } from "../../../shared/live";
import {
  applyLiveMessage,
  beginIntent,
  beginLiveTurn,
  beginOpen,
  beginReceipts,
  liveOf,
  liveStore,
} from "./live";

// Live's request map is private. Settle every request we create, then remove only
// this file's conversation keys; never reset another test's singleton state.
const conversations = new Set<string>();
const requests = new Set<string>();
const unsubscribers: Array<() => void> = [];

function conversation(suffix: string): string {
  const id = "DASH2-148-" + suffix;
  conversations.add(id);
  return id;
}

function track(id: string): string {
  requests.add(id);
  return id;
}

function html(version: number, title: string): LiveArtifact {
  return {
    kind: "html",
    version,
    bytes: 8,
    sha256: "hash-" + version,
    html: "<main>" + title + "</main>",
    title,
    createdAt: version,
  };
}

function receipt(kind: LiveReceipt["kind"], summary: string): LiveReceipt {
  return { kind, summary, decisions: [summary], artifacts: [], at: 1 };
}

function choice(id: string, prompt: string): LiveControl {
  return { id, kind: "choice", prompt, options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] };
}

function opened(id: string, workerId: string, profileId: string, parentSessionId: string, artifacts: LiveArtifact[] = []): void {
  const message: LiveServerMessage = {
    type: "live_opened",
    id,
    workerId,
    profileId,
    parentSessionId,
    parentTitle: parentSessionId,
    model: "fixture-model",
    artifacts,
  };
  applyLiveMessage(message);
}

function open(conversationId: string, workerId: string, profileId: string, sessionId: string): void {
  opened(track(beginOpen(conversationId)), workerId, profileId, sessionId);
}

function event(id: string, workerId: string, seq: number, value: LiveEvent): void {
  const message: LiveServerMessage = { type: "live_event", id, workerId, seq, event: value };
  applyLiveMessage(message);
}

afterEach(() => {
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  // Terminal responses also clear requests which were deliberately left pending
  // by regression cases. Already-settled ids are ignored by applyLiveMessage.
  for (const id of requests) applyLiveMessage({ type: "live_error", id, message: "fixture cleanup" });
  requests.clear();
  liveStore.set(all => {
    const next = { ...all };
    for (const id of conversations) delete next[id];
    return next;
  });
  conversations.clear();
});

describe("Live surface request correlation", () => {
  test("interleaved open, turn, intent and receipts responses stay on their exact conversations", () => {
    const first = conversation("interleave-first");
    const second = conversation("interleave-second");
    const openFirst = track(beginOpen(first));
    const openSecond = track(beginOpen(second));

    opened(openSecond, "worker-b", "profile-b", "session-b");
    expect(liveOf(first).status).toBe("opening");
    expect(liveOf(first).workerId).toBeUndefined();
    opened(openFirst, "worker-a", "profile-a", "session-a");

    const turn = track(beginLiveTurn(first, "Build a card", true));
    const intent = track(beginIntent(second, {
      controlId: "layout",
      value: "columns",
      label: "Two columns",
      artifactVersion: 1,
    }));
    event(intent, "worker-b", 1, { type: "artifact", artifact: html(3, "B only") });
    event(turn, "worker-a", 1, { type: "delta", text: "A only" });
    event(intent, "worker-b", 2, { type: "control", control: choice("b-choice", "Choose B") });
    event(intent, "worker-b", 3, { type: "receipt", receipt: receipt("intent", "B picked columns") });
    const fetchFirstReceipts = track(beginReceipts(first));
    applyLiveMessage({
      type: "live_receipts",
      id: fetchFirstReceipts,
      workerId: "worker-a",
      receipts: [receipt("turn", "A receipt")],
    });

    expect(liveOf(first).busy).toBe(true);
    expect(liveOf(second).busy).toBe(true);
    event(intent, "worker-b", 4, { type: "done", stopReason: "end_turn" });
    expect(liveOf(first).busy).toBe(true);
    event(turn, "worker-a", 2, { type: "done", stopReason: "end_turn" });

    expect(liveOf(first)).toMatchObject({
      status: "ready", workerId: "worker-a", profileId: "profile-a",
      parentSessionId: "session-a", busy: false,
      controls: [], artifacts: [],
    });
    expect(liveOf(second)).toMatchObject({
      status: "ready", workerId: "worker-b", profileId: "profile-b",
      parentSessionId: "session-b", busy: false,
    });
    expect(liveOf(first).lines.map(line => line.text)).toEqual(["Ask Hermes: Build a card", "A only"]);
    expect(liveOf(second).lines.map(line => line.text)).toEqual(["Picked Two columns"]);
    expect(liveOf(first).receipts.map(item => item.summary)).toEqual(["A receipt"]);
    expect(liveOf(second).receipts.map(item => item.summary)).toEqual(["B picked columns"]);
    expect(liveOf(second).artifacts.map(item => item.title)).toEqual(["B only"]);
    expect(liveOf(second).shownVersion).toBe(3);
    expect(liveOf(second).controls.map(item => item.id)).toEqual(["b-choice"]);
  });

  test("unknown ids do not mutate the store or notify subscribers", () => {
    const id = conversation("unknown-id");
    open(id, "worker-known", "profile", "session");
    const before = liveOf(id);
    let changes = 0;
    unsubscribers.push(liveStore.subscribe(() => { changes += 1; }));

    event("DASH2-148-unregistered", "worker-known", 1, { type: "delta", text: "unexpected" });
    applyLiveMessage({ type: "live_error", id: "DASH2-148-unregistered", message: "unexpected" });
    applyLiveMessage({
      type: "live_receipts", id: "DASH2-148-unregistered",
      workerId: "worker-known", receipts: [receipt("turn", "unexpected")],
    });
    opened("DASH2-148-unregistered", "worker-foreign", "foreign", "foreign");
    expect(liveOf(id)).toBe(before);
    expect(changes).toBe(0);
  });

  test("events replayed after a terminal response cannot resurrect finished work", () => {
    const id = conversation("terminal-replay");
    open(id, "worker", "profile", "session");
    const turn = track(beginLiveTurn(id, "One turn", false));
    event(turn, "worker", 1, { type: "delta", text: "real answer" });
    event(turn, "worker", 2, { type: "done", stopReason: "end_turn" });
    const settled = liveOf(id);

    event(turn, "worker", 3, { type: "delta", text: "late output" });
    event(turn, "worker", 4, { type: "artifact", artifact: html(8, "late") });
    event(turn, "worker", 5, { type: "control", control: choice("late", "late") });
    event(turn, "worker", 6, { type: "receipt", receipt: receipt("turn", "late") });
    applyLiveMessage({ type: "live_error", id: turn, message: "late failure" });
    applyLiveMessage({ type: "live_receipts", id: turn, workerId: "worker", receipts: [] });

    expect(liveOf(id)).toBe(settled);
    expect(liveOf(id).lines.at(-1)).toMatchObject({ state: "done", text: "real answer" });
    expect(liveOf(id).busy).toBe(false);
  });

  test("control and artifact replacement is keyed, and a worker error never claims success", () => {
    const id = conversation("controls-error");
    open(id, "worker", "profile", "session");
    const turn = track(beginLiveTurn(id, "Try controls", false));

    event(turn, "worker", 1, { type: "control", control: choice("choice-one", "First") });
    event(turn, "worker", 2, { type: "control", control: choice("choice-one", "Revised") });
    event(turn, "worker", 3, { type: "artifact", artifact: html(1, "Old version") });
    event(turn, "worker", 4, { type: "artifact", artifact: html(1, "Replaced version") });
    event(turn, "worker", 5, { type: "receipt", receipt: receipt("turn", "Partial work only") });
    event(turn, "worker", 6, { type: "error", message: "Worker failed before completion" });

    expect(liveOf(id)).toMatchObject({ status: "ready", busy: false, shownVersion: 1 });
    expect(liveOf(id).controls).toHaveLength(1);
    expect(liveOf(id).controls[0]).toMatchObject({ id: "choice-one", prompt: "Revised" });
    expect(liveOf(id).artifacts).toHaveLength(1);
    expect(liveOf(id).artifacts[0]?.title).toBe("Replaced version");
    expect(liveOf(id).receipts.map(item => item.summary)).toEqual(["Partial work only"]);
    expect(liveOf(id).lines.at(-1)).toMatchObject({ state: "error", text: "Worker failed before completion" });
    event(turn, "worker", 7, { type: "done", stopReason: "end_turn" });
    expect(liveOf(id).lines.at(-1)?.state).toBe("error");
  });

  test("request-level failure leaves an error line, not a fabricated reply or receipt", () => {
    const id = conversation("request-error");
    open(id, "worker", "profile", "session");
    const turn = track(beginLiveTurn(id, "Failing request", false));
    applyLiveMessage({ type: "live_error", id: turn, message: "Host unavailable" });

    expect(liveOf(id).status).toBe("ready");
    expect(liveOf(id).busy).toBe(false);
    expect(liveOf(id).lines.at(-1)).toMatchObject({ state: "error", text: "Host unavailable" });
    expect(liveOf(id).receipts).toEqual([]);
    expect(liveOf(id).artifacts).toEqual([]);
    event(turn, "worker", 1, { type: "delta", text: "fake recovery" });
    expect(liveOf(id).lines.at(-1)?.text).toBe("Host unavailable");
  });
});

describe("stale responses must not replace a newer surface operation", () => {
  test("delayed open from an old request cannot swap the current worker, profile or session", () => {
    const id = conversation("stale-open");
    const oldOpen = track(beginOpen(id));
    const latestOpen = track(beginOpen(id));
    opened(latestOpen, "worker-current", "profile-current", "session-current");
    opened(oldOpen, "worker-old", "profile-old", "session-old");

    // Regression: live.ts currently accepts both pending ids, replacing identity.
    expect(liveOf(id)).toMatchObject({
      workerId: "worker-current",
      profileId: "profile-current",
      parentSessionId: "session-current",
    });
  });

  test("events from a foreign worker are rejected even with a valid request id", () => {
    const id = conversation("foreign-worker-event");
    open(id, "worker-own", "profile-own", "session-own");
    const turn = track(beginLiveTurn(id, "Private to this worker", false));
    event(turn, "worker-foreign", 1, { type: "delta", text: "WRONG WORKER" });

    // Regression: request ids are looked up, but live_event.workerId is not checked.
    expect(liveOf(id).lines.find(line => line.id === "w_" + turn)?.text).toBe("");
    event(turn, "worker-own", 2, { type: "delta", text: "right worker" });
    expect(liveOf(id).lines.find(line => line.id === "w_" + turn)?.text).toBe("right worker");
  });

  test("a foreign worker's receipts cannot overwrite the owning worker's history", () => {
    const id = conversation("foreign-receipts");
    open(id, "worker-own", "profile-own", "session-own");
    const first = track(beginReceipts(id));
    applyLiveMessage({
      type: "live_receipts", id: first, workerId: "worker-foreign",
      receipts: [receipt("turn", "not our receipt")],
    });

    // Regression: live_receipts currently checks only the request id.
    expect(liveOf(id).receipts).toEqual([]);
    applyLiveMessage({
      type: "live_receipts", id: first, workerId: "worker-own",
      receipts: [receipt("turn", "our receipt")],
    });
    expect(liveOf(id).receipts.map(item => item.summary)).toEqual(["our receipt"]);
  });

  test("old completion cannot clear busy or stamp timing for the newer turn", () => {
    const id = conversation("old-done");
    open(id, "worker", "profile", "session");
    const older = track(beginLiveTurn(id, "Old request", false));
    const newer = track(beginLiveTurn(id, "New request", false));
    event(older, "worker", 1, { type: "done", stopReason: "end_turn" });

    // Regression: live.ts unconditionally sets busy:false and doneAt on old done.
    expect(liveOf(id).busy).toBe(true);
    expect(liveOf(id).timing?.doneAt).toBeUndefined();
    event(newer, "worker", 1, { type: "delta", text: "still running" });
    expect(liveOf(id).lines.find(line => line.id === "w_" + newer)?.state).toBe("streaming");
  });

  test("a failed receipts refresh cannot cancel an unrelated live turn", () => {
    const id = conversation("receipts-fail");
    open(id, "worker", "profile", "session");
    const active = track(beginLiveTurn(id, "Keep working", false));
    const refresh = track(beginReceipts(id));
    applyLiveMessage({ type: "live_error", id: refresh, message: "Receipts unavailable" });

    // Regression: a receipts-only request currently sets the conversation busy=false.
    expect(liveOf(id).busy).toBe(true);
    expect(liveOf(id).lines.find(line => line.id === "w_" + active)?.state).toBe("streaming");
  });

  test("replayed lower-sequence deltas cannot duplicate or reorder streamed text", () => {
    const id = conversation("sequence-replay");
    open(id, "worker", "profile", "session");
    const turn = track(beginLiveTurn(id, "Stream once", false));
    event(turn, "worker", 2, { type: "delta", text: "newest" });
    event(turn, "worker", 1, { type: "delta", text: "stale" });

    // Regression: live.ts does not track or reject per-request sequence numbers.
    expect(liveOf(id).lines.find(line => line.id === "w_" + turn)?.text).toBe("newest");
  });
});
