/** WebSocket transport keepalive, separate from the shared chat message protocol. */
export const SOCKET_KEEPALIVE_INTERVAL_MS = 30_000;
const PING_FRAME = '{"type":"ping"}';
const SOCKET_OPEN = 1;

export interface KeepaliveSocket {
  readonly readyState: number;
  send(frame: string): void;
}

export interface TurnCursor {
  id: string;
  seq: number;
}

export type KeepaliveScheduler = (tick: () => void, intervalMs: number) => () => void;

const repeat: KeepaliveScheduler = (tick, intervalMs) => {
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
};

/** Begin only after onopen; dispose on close, stop and socket replacement. */
export function startSocketKeepalive(socket: KeepaliveSocket, schedule: KeepaliveScheduler = repeat): () => void {
  return schedule(() => {
    if (socket.readyState !== SOCKET_OPEN) return;
    try {
      socket.send(PING_FRAME);
    } catch {
      // A native socket may close between the state check and send.
      // The owner's onclose handler manages reconnection.
    }
  }, SOCKET_KEEPALIVE_INTERVAL_MS);
}

/** Every server hello (including after reconnect) reattaches live turn cursors. */
export function reattachStreamingTurns(socket: KeepaliveSocket, turns: readonly TurnCursor[]): boolean {
  if (socket.readyState !== SOCKET_OPEN || turns.length === 0) return false;
  socket.send(JSON.stringify({ type: "attach", turns }));
  return true;
}
