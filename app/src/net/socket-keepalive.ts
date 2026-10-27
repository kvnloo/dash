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

/** No inbound frame for this long on a bridge that answers pings = half-open socket. */
export const SOCKET_DEAD_AFTER_MS = SOCKET_KEEPALIVE_INTERVAL_MS * 2.5;

/**
 * Dead-socket detection. Armed only once the bridge has answered a ping with a pong,
 * so an older bridge that never answers pings is never closed for being quiet.
 */
export interface KeepaliveLiveness {
  lastInboundAt(): number;
  pongSeen(): boolean;
  onDead(): void;
  now?: () => number;
}

export function isPongFrame(raw: string): boolean {
  return raw.length < 64 && raw.replace(/\s/g, "") === '{"type":"pong"}';
}

const repeat: KeepaliveScheduler = (tick, intervalMs) => {
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
};

/** Begin only after onopen; dispose on close, stop and socket replacement. */
export function startSocketKeepalive(socket: KeepaliveSocket, schedule: KeepaliveScheduler = repeat, liveness?: KeepaliveLiveness): () => void {
  return schedule(() => {
    if (socket.readyState !== SOCKET_OPEN) return;
    if (liveness?.pongSeen() && (liveness.now ?? Date.now)() - liveness.lastInboundAt() > SOCKET_DEAD_AFTER_MS) {
      liveness.onDead();
      return;
    }
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
