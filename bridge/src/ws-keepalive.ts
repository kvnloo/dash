/** Bun WebSocket idle timeout is in seconds (max 255). Leave ample room for the phone's 30s pings. */
export const BRIDGE_WS_IDLE_TIMEOUT_SECONDS = 180;
const PONG_FRAME = '{"type":"pong"}';

/** Handle transport-only pings before the shared ClientMessage parser. */
export function acknowledgeSocketPing(payload: unknown, send: (frame: string) => void): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  if (!("type" in payload) || payload.type !== "ping" || Object.keys(payload).length !== 1) return false;
  send(PONG_FRAME);
  return true;
}
