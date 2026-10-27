import { describe, expect, test } from "bun:test";
import { SOCKET_KEEPALIVE_INTERVAL_MS } from "../../app/src/net/socket-keepalive";
import { acknowledgeSocketPing, BRIDGE_WS_IDLE_TIMEOUT_SECONDS } from "./ws-keepalive";

describe("bridge WebSocket liveness", () => {
  test("idle timeout exceeds the client's interval and stays within Bun's limit", () => {
    expect(BRIDGE_WS_IDLE_TIMEOUT_SECONDS * 1000).toBeGreaterThan(SOCKET_KEEPALIVE_INTERVAL_MS);
    expect(BRIDGE_WS_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(255);
  });

  test("acknowledges a transport ping without handing it to the chat parser", () => {
    const frames: string[] = [];
    expect(acknowledgeSocketPing({ type: "ping" }, frame => { frames.push(frame); })).toBe(true);
    expect(frames).toEqual(['{"type":"pong"}']);
  });

  test("does not accept malformed pings or swallow application messages", () => {
    const frames: string[] = [];
    const reply = (frame: string) => { frames.push(frame); };
    for (const payload of [
      null,
      "ping",
      ["ping"],
      { type: "ping", id: "unrelated" },
      { type: "pong" },
      { type: "attach", turns: [] },
      { type: "chat", id: "turn-1" },
    ]) {
      expect(acknowledgeSocketPing(payload, reply)).toBe(false);
    }
    expect(frames).toEqual([]);
  });
});
