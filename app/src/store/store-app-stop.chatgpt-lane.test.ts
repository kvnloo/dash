import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ChatAttachment } from "../../../shared/protocol";
import type { AssistantMessage, UserMessage } from "../model";

/**
 * app.ts imports native AsyncStorage. Keep mock.module in a fresh Bun test process:
 * a module mock installed in the shared suite would alter unrelated store tests.
 */
const CHILD = "DASH_STORE_APP_STOP_ISOLATED";

if (process.env[CHILD] !== "1") {
  test("Stop / lost-turn / unsent-turn store regressions (isolated native mock)", () => {
    const result = spawnSync(process.execPath, ["test", fileURLToPath(import.meta.url)], {
      cwd: process.cwd(),
      env: { ...process.env, [CHILD]: "1" },
      encoding: "utf8",
      timeout: 20_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Isolated store tests exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    }
    expect(result.status).toBe(0);
  }, 25_000);
} else {
  const persisted = new Map<string, string>();
  mock.module("@react-native-async-storage/async-storage", () => ({
    default: {
      async multiGet(keys: string[]) {
        return keys.map((key): [string, string | null] => [key, persisted.get(key) ?? null]);
      },
      async multiSet(entries: [string, string][]) {
        for (const [key, value] of entries) persisted.set(key, value);
      },
      async setItem(key: string, value: string) { persisted.set(key, value); },
      async multiRemove(keys: string[]) { for (const key of keys) persisted.delete(key); },
    },
  }));
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  });

  const app = await import("./app");
  const { parseConversation } = await import("../model");
  const { dequeue, enqueue, onTurnSettled, queueLength } = await import("./queue");
  const { partsFor, replyParts, replyText } = await import("./text");

  const conversationIds = new Set<string>();
  const turnIds = new Set<string>();
  const unsubscribers: Array<() => void> = [];

  function chat(): string {
    const conversation = app.createConversation("omp", {
      sessionId: "synthetic-session",
      cwd: "/synthetic/project",
    });
    conversationIds.add(conversation.id);
    return conversation.id;
  }

  function turn(conversationId: string, text: string, opts?: Parameters<typeof app.beginTurn>[2]) {
    const started = app.beginTurn(conversationId, text, opts);
    turnIds.add(started.turnId);
    return started;
  }

  function assistant(conversationId: string, turnId: string): AssistantMessage {
    const message = app.store.get().conversations
      .find((item) => item.id === conversationId)?.messages
      .find((item) => item.role === "assistant" && item.turnId === turnId);
    if (message?.role !== "assistant") throw new Error(`Missing assistant for ${turnId}`);
    return message;
  }

  function user(conversationId: string, turnId: string): UserMessage {
    const conversation = app.store.get().conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error(`Missing conversation ${conversationId}`);
    const index = conversation.messages.findIndex((item) => item.role === "assistant" && item.turnId === turnId);
    const message = conversation.messages[index - 1];
    if (message?.role !== "user") throw new Error(`Missing user for ${turnId}`);
    return message;
  }

  beforeEach(() => {
    persisted.clear();
    app.store.set({
      hydrated: true,
      settings: null,
      connection: { status: "online", harnesses: [], hosts: [] },
      conversations: [],
      activeId: null,
    });
  });

  afterEach(async () => {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    // A terminal replay clears private keyed sequence bookkeeping, without
    // changing interrupted turns. Remove every synthetic keyed store entry.
    for (const id of turnIds) {
      app.applyTurnEvent({ type: "done", id, seq: Number.MAX_SAFE_INTEGER, exitCode: 0 });
      replyText.clear(id);
      replyParts.clear(id);
    }
    for (const id of conversationIds) while (dequeue(id) !== undefined) { /* clean queue */ }
    turnIds.clear();
    conversationIds.clear();
    // app.ts batches persistence on a 400 ms timer with no public cancel hook.
    // Let it finish before another case resets the in-memory storage fixture.
    await new Promise<void>((resolve) => setTimeout(resolve, 440));
    persisted.clear();
    app.store.set({
      hydrated: true,
      settings: null,
      connection: { status: "online", harnesses: [], hosts: [] },
      conversations: [],
      activeId: null,
    });
  });

  describe("stopConversation", () => {
    test("cancels only this conversation's streaming turn once; keeps user, partial output, completed reply and queued text", () => {
      const target = chat();
      const running = turn(target, "keep first request");
      const waiting = turn(target, "keep unsent follow-up", { pending: true });
      const finished = turn(target, "already finished");
      replyText.set(finished.turnId, "Old completed answer");
      app.applyTurnEvent({ type: "done", id: finished.turnId, seq: 1, exitCode: 0 });

      const other = chat();
      const unrelated = turn(other, "different conversation");
      app.applyDeltas(new Map([[running.turnId, { text: "Partially streamed answer", seq: 2 }]]));
      const reasoning = { kind: "reasoning", text: "Partial reasoning" } satisfies import("../../../shared/protocol").ReplyPart;
      replyParts.set(running.turnId, JSON.stringify([reasoning]));
      enqueue(target, waiting.turnId);
      app.previewQueued(target);
      app.setQueueWaiting(target, true);

      const settled: Array<{ id: string; queueSize: number }> = [];
      unsubscribers.push(onTurnSettled((id) => settled.push({ id, queueSize: queueLength(id) })));
      const canceled: string[] = [];
      const cancel = (id: string) => { canceled.push(id); };
      app.stopConversation(target, cancel);

      expect(canceled).toEqual([running.turnId]);
      expect(settled).toEqual([{ id: target, queueSize: 0 }]);
      expect(assistant(target, running.turnId)).toMatchObject({
        state: "interrupted",
        text: "Partially streamed answer",
        parts: [reasoning],
        status: "Stopped",
      });
      expect(assistant(target, waiting.turnId)).toMatchObject({ state: "interrupted" });
      expect(assistant(target, finished.turnId)).toMatchObject({ state: "done", text: "Old completed answer" });
      expect(assistant(other, unrelated.turnId)).toMatchObject({ state: "streaming" });
      expect(user(target, running.turnId).text).toBe("keep first request");
      expect(user(target, waiting.turnId).text).toBe("keep unsent follow-up");
      expect(app.store.get().conversations.find((item) => item.id === target)).toMatchObject({
        queuePreview: undefined,
        queueWaitForIdle: false,
      });
      expect(app.conversationBusy(target)).toBe(false);
      expect(app.promotePendingTurn(waiting.turnId)).toBeNull();

      app.stopConversation(target, cancel);
      app.applyDeltas(new Map([[running.turnId, { text: "late delta", seq: 3 }]]));
      app.applyTurnEvent({ type: "done", id: running.turnId, seq: 4, exitCode: 0 });
      expect(canceled).toEqual([running.turnId]);
      expect(assistant(target, running.turnId)).toMatchObject({
        state: "interrupted", text: "Partially streamed answer", status: "Stopped",
      });
      expect(user(target, running.turnId).text).toBe("keep first request");
      let sent = 0;
      expect(app.flushPendingSends(() => { sent += 1; return true; })).toBe(0);
      expect(sent).toBe(0);
    });

    test("pending-only Stop never calls transport cancellation; repeated Stop cannot send the pending user message", () => {
      const id = chat();
      const pending = turn(id, "do not dispatch offline text", { pending: true });
      const canceled: string[] = [];
      app.stopConversation(id, (turnId) => { canceled.push(turnId); });
      app.stopConversation(id, (turnId) => { canceled.push(turnId); });
      expect(canceled).toEqual([]);
      expect(assistant(id, pending.turnId).state).toBe("interrupted");
      expect(user(id, pending.turnId).text).toBe("do not dispatch offline text");
      expect(app.parkUnsentTurn(pending.turnId)).toBe(false);
      expect(app.flushPendingSends(() => { throw new Error("Interrupted pending turn dispatched"); })).toBe(0);
    });
  });

  describe("markTurnLost", () => {
    test("retains partial transcript and parts, marks interrupted rather than success, and rejects late replay", () => {
      const id = chat();
      const active = turn(id, "preserve the prompt");
      app.applyDeltas(new Map([[active.turnId, { text: "Partial streamed transcript", seq: 2 }]]));
      app.applyTurnEvent({ type: "status", id: active.turnId, seq: 3, text: "Working on request" });
      const part = { kind: "reasoning", text: "Unfinished reasoning" } satisfies import("../../../shared/protocol").ReplyPart;
      replyParts.set(active.turnId, JSON.stringify([part]));

      app.markTurnLost(active.turnId);
      expect(assistant(id, active.turnId)).toMatchObject({
        state: "interrupted",
        status: undefined,
        text: "Partial streamed transcript",
        parts: [part],
      });
      expect(user(id, active.turnId).text).toBe("preserve the prompt");
      expect(app.streamingTurns().some((item) => item.id === active.turnId)).toBe(false);
      const snapshot = app.store.get().conversations.find((item) => item.id === id);
      const restored = parseConversation(JSON.parse(JSON.stringify(snapshot)));
      expect(restored?.messages.find((item) => item.role === "assistant" && item.turnId === active.turnId))
        .toMatchObject({ state: "interrupted", text: "Partial streamed transcript", parts: [part] });

      app.applyDeltas(new Map([[active.turnId, { text: "late output", seq: 4 }]]));
      app.applyTurnEvent({ type: "done", id: active.turnId, seq: 5, exitCode: 0 });
      app.applyTurnEvent({ type: "error", id: active.turnId, seq: 6, message: "late error" });
      app.markTurnLost(active.turnId);
      app.markTurnLost("unknown-turn");
      expect(assistant(id, active.turnId)).toMatchObject({
        state: "interrupted", text: "Partial streamed transcript", status: undefined,
      });
      expect(partsFor(active.turnId)).toEqual([part]);
    });

    test("cannot turn a pending or completed reply into a lost streaming reply", () => {
      const id = chat();
      const pending = turn(id, "still on phone", { pending: true });
      const completed = turn(id, "already answered");
      replyText.set(completed.turnId, "Complete");
      app.applyTurnEvent({ type: "done", id: completed.turnId, seq: 1, exitCode: 0 });
      app.markTurnLost(pending.turnId);
      app.markTurnLost(completed.turnId);
      expect(assistant(id, pending.turnId).state).toBe("pending");
      expect(assistant(id, completed.turnId)).toMatchObject({ state: "done", text: "Complete" });
    });
  });

  describe("parkUnsentTurn", () => {
    test("parks one unsent streaming turn without dropping exact prompt or attachments; reconnect sends same id once", () => {
      const id = chat();
      const attachment: ChatAttachment = {
        id: "0123456789abcdef0123456789abcdef",
        name: "trace.txt",
        mime: "text/plain",
        size: 81,
      };
      const running = turn(id, "retry original payload", { attachments: [attachment] });
      expect(app.parkUnsentTurn(running.turnId)).toBe(true);
      expect(app.parkUnsentTurn(running.turnId)).toBe(false);
      expect(assistant(id, running.turnId)).toMatchObject({ state: "pending", error: undefined });
      expect(queueLength(id)).toBe(1);
      expect(user(id, running.turnId)).toMatchObject({
        text: "retry original payload", attachments: [attachment],
      });

      const sent: Array<{ turnId: string; text: string; harness: string; sessionId?: string; cwd?: string; attachments?: ChatAttachment[] }> = [];
      expect(app.flushPendingSends((input) => { sent.push(input); return true; })).toBe(1);
      expect(sent).toEqual([{
        turnId: running.turnId,
        text: "retry original payload",
        harness: "omp",
        sessionId: "synthetic-session",
        cwd: "/synthetic/project",
        attachments: [attachment],
      }]);
      expect(queueLength(id)).toBe(0);
      expect(app.flushPendingSends(() => { throw new Error("Duplicate reconnect send"); })).toBe(0);
      expect(assistant(id, running.turnId).state).toBe("streaming");
      expect(user(id, running.turnId).text).toBe("retry original payload");
    });

    test("rejects missing, already pending, done and interrupted turns", () => {
      const id = chat();
      const pending = turn(id, "queued", { pending: true });
      const done = turn(id, "completed");
      replyText.set(done.turnId, "Completed answer");
      app.applyTurnEvent({ type: "done", id: done.turnId, seq: 1, exitCode: 0 });
      const lost = turn(id, "lost");
      app.markTurnLost(lost.turnId);
      expect(app.parkUnsentTurn("absent")).toBe(false);
      expect(app.parkUnsentTurn(pending.turnId)).toBe(false);
      expect(app.parkUnsentTurn(done.turnId)).toBe(false);
      expect(app.parkUnsentTurn(lost.turnId)).toBe(false);
      expect(queueLength(id)).toBe(0);
    });

    test("must not requeue a turn the bridge already acknowledged as started", () => {
      const id = chat();
      const started = turn(id, "already running on host");
      app.applyTurnEvent({
        type: "status",
        id: started.turnId,
        seq: 1,
        text: "Execution started",
        delivery: "started",
        deliveryAt: 42,
      });
      expect(user(id, started.turnId).delivery).toBe("started");
      // RED REGRESSION ON BASE: parkUnsentTurn checks only assistant.state.
      // A started receipt proves this is not a safely retryable unsent turn.
      expect(app.parkUnsentTurn(started.turnId)).toBe(false);
      expect(assistant(id, started.turnId).state).toBe("streaming");
      expect(queueLength(id)).toBe(0);
    });
  });
}
