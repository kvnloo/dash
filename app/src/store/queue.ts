/** Per-conversation turn queue — yap while the agent is still streaming. */

const queues = new Map<string, string[]>();
const listeners = new Set<(conversationId: string) => void>();

export function enqueue(conversationId: string, turnId: string): void {
  const q = queues.get(conversationId) ?? [];
  q.push(turnId);
  queues.set(conversationId, q);
}

export function dequeue(conversationId: string): string | undefined {
  const q = queues.get(conversationId);
  if (!q?.length) return undefined;
  const [head, ...rest] = q;
  if (rest.length === 0) queues.delete(conversationId);
  else queues.set(conversationId, rest);
  return head;
}

export function queueLength(conversationId: string): number {
  return queues.get(conversationId)?.length ?? 0;
}

export function onTurnSettled(cb: (conversationId: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function notifyTurnSettled(conversationId: string): void {
  for (const cb of listeners) cb(conversationId);
}
