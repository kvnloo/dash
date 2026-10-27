import { describe, expect, test } from "bun:test";
import { isPongFrame, reattachStreamingTurns, SOCKET_DEAD_AFTER_MS, SOCKET_KEEPALIVE_INTERVAL_MS, startSocketKeepalive } from "./socket-keepalive";

describe("client WebSocket keepalive", () => {
  test("sends an application ping every 30 seconds only while open, and cancels the timer", () => {
    const frames: string[] = [];
    const socket = { readyState: 1, send(frame: string) { frames.push(frame); } };
    const clock = { tick: () => {}, intervalMs: 0, cancelled: 0 };
    const stop = startSocketKeepalive(socket, (tick, intervalMs) => {
      clock.tick = tick;
      clock.intervalMs = intervalMs;
      return () => { clock.cancelled += 1; };
    });

    expect(clock.intervalMs).toBe(30_000);
    expect(SOCKET_KEEPALIVE_INTERVAL_MS).toBe(30_000);
    expect(frames).toEqual([]);
    clock.tick();
    clock.tick();
    expect(frames).toEqual(['{"type":"ping"}', '{"type":"ping"}']);

    socket.readyState = 3;
    clock.tick();
    expect(frames).toHaveLength(2);
    stop();
    expect(clock.cancelled).toBe(1);
  });

  test("a native close racing with ping does not crash the timer", () => {
    const socket = { readyState: 1, send(_frame: string) { throw new Error("socket closed"); } };
    const clock = { tick: () => {} };
    const stop = startSocketKeepalive(socket, tick => {
      clock.tick = tick;
      return () => {};
    });
    expect(() => clock.tick()).not.toThrow();
    stop();
  });
});

describe("socket reconnect subscription", () => {
  test("attaches streaming turns with last received seq on each new hello", () => {
    const firstFrames: string[] = [];
    const first = { readyState: 1, send(frame: string) { firstFrames.push(frame); } };
    const initial = [{ id: "turn-1", seq: 4 }, { id: "turn-2", seq: 0 }];
    expect(reattachStreamingTurns(first, initial)).toBe(true);
    expect(JSON.parse(firstFrames[0] ?? "")).toEqual({ type: "attach", turns: initial });

    first.readyState = 3;
    expect(reattachStreamingTurns(first, initial)).toBe(false);
    expect(firstFrames).toHaveLength(1);

    const nextFrames: string[] = [];
    const next = { readyState: 1, send(frame: string) { nextFrames.push(frame); } };
    expect(reattachStreamingTurns(next, [{ id: "turn-1", seq: 9 }])).toBe(true);
    expect(JSON.parse(nextFrames[0] ?? "")).toEqual({
      type: "attach", turns: [{ id: "turn-1", seq: 9 }],
    });
    expect(reattachStreamingTurns(next, [])).toBe(false);
    expect(nextFrames).toHaveLength(1);
  });
  test("a bridge that answered pings and then goes silent is declared dead instead of pinged forever", () => {
    const frames: string[] = [];
    const socket = { readyState: 1, send(frame: string) { frames.push(frame); } };
    let tick = () => {};
    let now = 1_000_000;
    let last = now;
    let pong = false;
    let dead = 0;
    startSocketKeepalive(socket, t => { tick = t; return () => {}; }, {
      lastInboundAt: () => last, pongSeen: () => pong, onDead: () => { dead += 1; }, now: () => now,
    });
    // Old bridge (never answers pings): quiet for minutes is not dead.
    now += SOCKET_DEAD_AFTER_MS * 4;
    tick();
    expect(dead).toBe(0);
    expect(frames).toHaveLength(1);
    // Bridge answers a ping: liveness is armed; recent traffic keeps it alive.
    pong = true; last = now;
    now += SOCKET_KEEPALIVE_INTERVAL_MS;
    tick();
    expect(dead).toBe(0);
    // Then nothing arrives for longer than the dead window: half-open socket.
    now += SOCKET_DEAD_AFTER_MS;
    tick();
    expect(dead).toBe(1);
    expect(frames).toHaveLength(2);
  });

  test("only an exact pong frame counts as a pong", () => {
    expect(isPongFrame('{"type":"pong"}')).toBe(true);
    expect(isPongFrame('{ "type": "pong" }')).toBe(true);
    expect(isPongFrame('{"type":"pong","x":1}')).toBe(false);
    expect(isPongFrame('{"type":"delta","text":"pong"}')).toBe(false);
  });
});
