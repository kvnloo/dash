import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ClientMessage } from "../../../shared/protocol";
import { createOutboxStore, type OutboxRecord } from "../store/outbox";
import { createOutboxStorage, type OutboxRecord as StoredRecord } from "../lib/outbox-storage";
import { DeliveryDeadlineController } from "../lib/delivery-deadline";
import { planOutboxReplay, replayChatMessage, type OutboxReplayRecord } from "../lib/outbox-replay";
import { locateTurn, store } from "../store/app";

const storage = createOutboxStorage(AsyncStorage);
let revision = 0;
let transmit: (message: ClientMessage) => boolean = () => false;
let ready = false;
let dedupe = false;
let generation = 0;

function stored(record: OutboxRecord): StoredRecord {
  const { mode, ...target } = record.target;
  return {
    clientId: record.clientId, turnId: record.turnId, conversationId: record.conversationId,
    stage: record.stage, attempts: record.attempts, createdAt: record.createdAt, updatedAt: record.updatedAt,
    retryNeeded: record.retryNeeded, error: record.error, target, mode,
    payload: { ...record.payload, attachments: record.payload.attachments?.map(item => ({ ...item })) },
    lastSentAt: record.lastAttemptAt,
    ...(record.stage === "started" ? { startedAt: record.receiptAt } : { ackedAt: record.receiptAt }),
  };
}

function replayRecord(record: OutboxRecord): OutboxReplayRecord {
  return { ...record, state: record.stage, mode: record.target.mode === "send" ? "normal" : record.target.mode };
}

export const deliveryOutbox = createOutboxStore({
  persistence: {
    async load() {
      const snapshot = await storage.load();
      revision = snapshot.revision;
      return snapshot.records.map((record): OutboxRecord => ({
        ...record, target: { ...record.target, mode: record.mode },
        lastAttemptAt: record.lastSentAt, receiptAt: record.startedAt ?? record.ackedAt,
      }));
    },
    async save(records) {
      const snapshot = await storage.save({ revision, records: records.map(stored) });
      revision = snapshot.revision;
    },
  },
  transport: {
    send(record) {
      if (!ready) return false;
      const sent = transmit(replayChatMessage(replayRecord(record)));
      if (sent) deadlines.trackSent(record.clientId, generation);
      return sent;
    },
  },
});

const deadlines = new DeliveryDeadlineController(event => {
  if (event.type === "retry-needed") void deliveryOutbox.markUnconfirmed(event.id).catch(console.warn);
});

export function deliveryConnected(send: (message: ClientMessage) => boolean, supported: boolean): void {
  transmit = send;
  dedupe = supported;
  ready = true;
  generation = deadlines.beginGeneration();
  void replayDeliveries();
}

export function deliveryDisconnected(): void {
  ready = false;
  dedupe = false;
  deadlines.disconnect(generation);
}

export async function receiveDelivery(receipt: Parameters<typeof deliveryOutbox.receiveReceipt>[0]): Promise<void> {
  const result = await deliveryOutbox.receiveReceipt(receipt);
  if (result.ok) deadlines.ack(receipt.clientId, generation);
}

export function retryDelivery(clientId: string) {
  return deliveryOutbox.retry(clientId, { dedupeSupported: ready && dedupe });
}

export async function replayDeliveries(): Promise<void> {
  const hydrated = await deliveryOutbox.hydrate();
  if (!hydrated.ok || !ready) return;
  const records = deliveryOutbox.get().filter(record => record.stage !== "started");
  const conversations = store.get().conversations;
  const decisions = planOutboxReplay({
    hydrated: true, peer: { durablePrincipalDedupe: dedupe, attach: true }, activeTurns: [],
    records: records.map(replayRecord),
    conversations: conversations.map(chat => ({
      conversationId: chat.id, ended: false, queuePreviewOpen: chat.queuePreview !== undefined,
      queueWaitForIdle: chat.queueWaitForIdle === true,
      target: { harness: chat.harness, hostId: chat.targetHostId, profileId: chat.profileId, sessionId: chat.sessionId, cwd: chat.cwd ?? store.get().settings?.cwd },
    })),
  });
  for (const decision of decisions) {
    if (!ready) return;
    if (decision.kind === "replay") await retryDelivery(decision.record.clientId);
    else if (decision.kind === "reconcile") transmit({ type: "attach", turns: [decision.attach] });
  }
}

export async function enqueueDelivery(input: {
  mode?: "steer" | "queue"; turnId: string; harness: string; text: string;
  sessionId?: string; cwd?: string; attachments?: Extract<ClientMessage, { type: "chat" }>["attachments"];
}): Promise<boolean> {
  const where = locateTurn(input.turnId);
  const chat = store.get().conversations.find(item => item.id === where?.conversationId);
  if (!chat) return false;
  if (deliveryOutbox.get().some(record => record.turnId === input.turnId)) return true;
  const result = await deliveryOutbox.enqueue({
    clientId: input.turnId, turnId: input.turnId, conversationId: chat.id,
    target: { harness: input.harness, mode: input.mode ?? "send", hostId: chat.targetHostId, profileId: chat.profileId, sessionId: input.sessionId, cwd: input.cwd ?? store.get().settings?.cwd },
    payload: { text: input.text, attachments: input.attachments, summariesEnabled: chat.summariesEnabled === true },
  }, { dispatch: false });
  if (!result.ok) throw new Error(result.message);
  if (ready) void retryDelivery(input.turnId);
  return true;
}
