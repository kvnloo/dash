import { afterEach, describe, expect, test } from "bun:test";
import {
  dequeue,
  enqueue,
  notifyTurnSettled,
  onTurnSettled,
  queueLength,
} from "./queue";

const touchedConversations = new Set<string>();
const subscriptions: Array<() => void> = [];
let nextId = 0;

function uniqueId(kind: string): string {
  nextId += 1;
  return `dash2-141-${kind}-${nextId}`;
}

function conversation(kind: string): string {
  const id = uniqueId(`conversation-${kind}`);
  touchedConversations.add(id);
  return id;
}

function listen(callback: (conversationId: string) => void): () => void {
  const unsubscribe = onTurnSettled(callback);
  subscriptions.push(unsubscribe);
  return unsubscribe;
}

// queue.ts stores queues and listeners in module-level singletons.
afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  for (const conversationId of touchedConversations) {
    const remaining = queueLength(conversationId);
    for (let i = 0; i < remaining; i += 1) dequeue(conversationId);
    expect(queueLength(conversationId)).toBe(0);
    expect(dequeue(conversationId)).toBeUndefined();
  }
  touchedConversations.clear();
});

describe("per-conversation FIFO queue", () => {
  test("an unknown queue is empty; enqueue and dequeue preserve FIFO and return to empty", () => {
    const chat = conversation("basic");
    const first = uniqueId("turn");
    const second = uniqueId("turn");
    const third = uniqueId("turn");

    expect(queueLength(chat)).toBe(0);
    expect(dequeue(chat)).toBeUndefined();

    enqueue(chat, first);
    enqueue(chat, second);
    expect(queueLength(chat)).toBe(2);
    expect(dequeue(chat)).toBe(first);
    expect(queueLength(chat)).toBe(1);
    expect(dequeue(chat)).toBe(second);
    expect(queueLength(chat)).toBe(0);
    expect(dequeue(chat)).toBeUndefined();

    // After the last item is removed, reusing the conversation starts fresh.
    enqueue(chat, third);
    expect(queueLength(chat)).toBe(1);
    expect(dequeue(chat)).toBe(third);
    expect(queueLength(chat)).toBe(0);
  });

  test("interleaved conversations keep independent insertion and removal order", () => {
    const alpha = conversation("alpha");
    const beta = conversation("beta");
    const alphaTurns = [uniqueId("alpha-turn"), uniqueId("alpha-turn"), uniqueId("alpha-turn")];
    const betaTurns = [uniqueId("beta-turn"), uniqueId("beta-turn")];

    enqueue(alpha, alphaTurns[0]!);
    enqueue(beta, betaTurns[0]!);
    enqueue(alpha, alphaTurns[1]!);
    enqueue(beta, betaTurns[1]!);
    enqueue(alpha, alphaTurns[2]!);

    expect(queueLength(alpha)).toBe(3);
    expect(queueLength(beta)).toBe(2);
    expect(dequeue(beta)).toBe(betaTurns[0]);
    expect(dequeue(alpha)).toBe(alphaTurns[0]);
    expect(queueLength(alpha)).toBe(2);
    expect(queueLength(beta)).toBe(1);
    expect(dequeue(alpha)).toBe(alphaTurns[1]);
    expect(dequeue(beta)).toBe(betaTurns[1]);
    expect(dequeue(alpha)).toBe(alphaTurns[2]);
    expect(queueLength(alpha)).toBe(0);
    expect(queueLength(beta)).toBe(0);
    expect(dequeue(beta)).toBeUndefined();
    expect(dequeue(alpha)).toBeUndefined();
  });

  test("duplicate turn ids are currently enqueued twice, not deduplicated", () => {
    const chat = conversation("duplicates");
    const other = conversation("independent");
    const repeated = uniqueId("repeated-turn");
    const otherTurn = uniqueId("other-turn");

    enqueue(chat, repeated);
    enqueue(chat, repeated);
    enqueue(other, otherTurn);

    expect(queueLength(chat)).toBe(2);
    expect(queueLength(other)).toBe(1);
    expect(dequeue(chat)).toBe(repeated);
    expect(queueLength(chat)).toBe(1);
    expect(dequeue(chat)).toBe(repeated);
    expect(dequeue(chat)).toBeUndefined();
    expect(dequeue(other)).toBe(otherTurn);
    expect(queueLength(chat)).toBe(0);
    expect(queueLength(other)).toBe(0);
  });
});

describe("turn settlement subscriptions", () => {
  test("settlement delivers the exact conversation id to registered listeners, without draining queues", () => {
    const alpha = conversation("settled-alpha");
    const beta = conversation("settled-beta");
    const allEvents: string[] = [];
    const alphaOnly: string[] = [];
    listen((id) => allEvents.push(id));
    listen((id) => {
      if (id === alpha) alphaOnly.push(id);
    });

    enqueue(alpha, uniqueId("queued-alpha"));
    enqueue(beta, uniqueId("queued-beta"));
    expect(allEvents).toEqual([]);

    // Subscription is global; consumers can filter on the supplied identity.
    notifyTurnSettled(beta);
    notifyTurnSettled(alpha);

    expect(allEvents).toEqual([beta, alpha]);
    expect(alphaOnly).toEqual([alpha]);
    expect(queueLength(alpha)).toBe(1);
    expect(queueLength(beta)).toBe(1);
  });

  test("unsubscribing one observer leaves others active; all unsubscribe cleanly", () => {
    const alpha = conversation("unsubscribe-alpha");
    const beta = conversation("unsubscribe-beta");
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    const unsubscribeFirst = listen((id) => firstEvents.push(id));
    const unsubscribeSecond = listen((id) => secondEvents.push(id));

    notifyTurnSettled(alpha);
    unsubscribeFirst();
    notifyTurnSettled(beta);
    unsubscribeFirst(); // An already-used cleanup is harmless.
    unsubscribeSecond();
    notifyTurnSettled(alpha);

    expect(firstEvents).toEqual([alpha]);
    expect(secondEvents).toEqual([alpha, beta]);
  });

  test("queue operations do not emit settlement events and cleanup leaves no pending items", () => {
    const chat = conversation("cleanup");
    const events: string[] = [];
    const stop = listen((id) => events.push(id));
    const first = uniqueId("queued");
    const second = uniqueId("queued");

    enqueue(chat, first);
    enqueue(chat, second);
    expect(dequeue(chat)).toBe(first);
    expect(dequeue(chat)).toBe(second);
    expect(events).toEqual([]);
    expect(queueLength(chat)).toBe(0);
    expect(dequeue(chat)).toBeUndefined();

    notifyTurnSettled(chat);
    expect(events).toEqual([chat]);
    stop();
    notifyTurnSettled(chat);
    expect(events).toEqual([chat]);
    expect(queueLength(chat)).toBe(0);
  });
});
