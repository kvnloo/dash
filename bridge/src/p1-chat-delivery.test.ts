// P1 regressions for #493 (chats missing) and #498 (follow-up messages never arrive).
// Run: bun test bridge/src/p1-chat-delivery.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visible } from "./hermes-sessions";
import { listFinishedSessions, nodeFsPort } from "./finished-sessions";
import { gatewaySteer } from "./hermes-steer";
import { sendIntoLiveSession } from "./hermes-live";
import * as continuation from "./hermes-continue";

describe("#493 every chat is listed", () => {
  test("Hermes GUI chats (SessionDB source 'gui') are visible", () => {
    expect(visible({ id: "20261120_072041_76d5cd", source: "gui", archived: 0, hidden: 0 })).toBe(true);
  });

  test("a Claude Code chat whose first record is larger than the head read is still listed", async () => {
    const home = mkdtempSync(join(tmpdir(), "dash-p1-"));
    const dir = join(home, ".claude", "projects", "-Users-kvn-big");
    mkdirSync(dir, { recursive: true });
    const prompt = "Review the Dash bridge roster. " + "x".repeat(200 * 1024);
    writeFileSync(join(dir, "6016aa07-71e2-48bc-8aa4-9913c633f98b.jsonl"), [
      { type: "session-owner", sessionId: "6016aa07-71e2-48bc-8aa4-9913c633f98b" },
      { type: "queue-operation", operation: "enqueue", timestamp: "2026-11-20T07:36:06.852Z", sessionId: "6016aa07-71e2-48bc-8aa4-9913c633f98b", content: prompt },
      { type: "user", cwd: "/Users/kvn/big", message: { role: "user", content: prompt } },
    ].map(row => JSON.stringify(row)).join("\n") + "\n");
    const rows = await listFinishedSessions({ fs: nodeFsPort(), homeDir: home, now: Date.now() });
    expect(rows.map(row => [row.kind, row.sessionId, row.name])).toEqual([
      ["claude", "6016aa07-71e2-48bc-8aa4-9913c633f98b", ("Review the Dash bridge roster. " + "x".repeat(29))],
    ]);
  });
});

describe("#498 gateway follow-ups reach Hermes off groot", () => {
  const savedSource = process.env.DASH_HERMES_SOURCE;
  const savedHome = process.env.HOME;
  function withHome(fn: (home: string) => Promise<void>) {
    return async () => {
      const home = mkdtempSync(join(tmpdir(), "dash-p1-home-"));
      mkdirSync(join(home, ".hermes", "hermes-agent"), { recursive: true });
      writeFileSync(join(home, ".hermes", "hermes-agent", "hermes_bootstrap.py"), "");
      delete process.env.DASH_HERMES_SOURCE;
      process.env.HOME = home;
      try { await fn(home); } finally {
        process.env.HOME = savedHome;
        if (savedSource === undefined) delete process.env.DASH_HERMES_SOURCE; else process.env.DASH_HERMES_SOURCE = savedSource;
      }
    };
  }
  const stream = (text: string) => new Response(text).body as ReadableStream<Uint8Array>;

  test("steer helper is told where this host's Hermes source lives", withHome(async home => {
    let seen: Record<string, string | undefined> = {};
    await gatewaySteer({ home: join(home, ".hermes"), sessionId: "local-1", text: "hi", spawnSteer: (_argv, options) => {
      seen = options.env;
      return { stdin: { write() {}, end() {} }, stdout: stream(JSON.stringify({ ok: true, code: "steered" })), exited: Promise.resolve(0), kill() {} };
    } });
    expect(seen.DASH_HERMES_SOURCE).toBe(join(home, ".hermes", "hermes-agent"));
  }));

  test("queued reply helper is told where this host's Hermes source lives", withHome(async home => {
    let seen: Record<string, string | undefined> = {};
    await sendIntoLiveSession({ argv: ["hermes-live"], home: join(home, ".hermes"), sessionId: "local-1", text: "hi", sink: { delta() {}, status() {} }, spawn: (_argv, options) => {
      seen = options.env;
      return { stdin: { write() {}, end() {} }, stdout: stream(JSON.stringify({ type: "result", exit_code: 0, session_id: "local-1", text: "ok" }) + "\n"), stderr: stream(""), exited: Promise.resolve(0), kill() {} };
    } }).catch(() => undefined);
    expect(seen.DASH_HERMES_SOURCE).toBe(join(home, ".hermes", "hermes-agent"));
  }));
});

describe("#498 a follow-up sent while Dash's own turn runs is not lost", () => {
  test("a steer to a session no gateway hosts is queued instead of failing", () => {
    const fallback = (continuation as Record<string, unknown>).steerFallsBackToQueue as ((mode: string | undefined, plan: string) => boolean) | undefined;
    expect(typeof fallback).toBe("function");
    expect(fallback?.("steer", "free")).toBe(true);
    expect(fallback?.("steer", "handoff")).toBe(true);
    expect(fallback?.("steer", "live")).toBe(false);
    expect(fallback?.("queue", "free")).toBe(false);
  });

  test("a steer while Dash's own reply is queued or running joins the queue, so messages keep their order", () => {
    const fallback = (continuation as Record<string, unknown>).steerFallsBackToQueue as ((mode: string | undefined, plan: string, dashBusy?: boolean) => boolean) | undefined;
    const busy = (continuation as Record<string, unknown>).dashReplyBusy as ((profile: string, session: string) => boolean) | undefined;
    expect(fallback?.("steer", "live", true)).toBe(true);
    expect(typeof busy).toBe("function");
    if (!busy) return;
    expect(busy("default", "local-order")).toBe(false);
    const held = continuation.claimContinuation("default", "local-order");
    expect(busy("default", "local-order")).toBe(true);
    held?.();
    const running = continuation.trackRunningTurn("local-order");
    expect(busy("default", "local-order")).toBe(true);
    running();
    expect(busy("default", "local-order")).toBe(false);
  });

  test("the queued follow-up waits for Dash's running turn in that session, then goes", async () => {
    const track = (continuation as Record<string, unknown>).trackRunningTurn as ((session: string) => () => void) | undefined;
    const wait = (continuation as Record<string, unknown>).awaitRunningTurn as ((session: string, signal: AbortSignal) => Promise<boolean>) | undefined;
    expect(typeof track).toBe("function");
    expect(typeof wait).toBe("function");
    if (!track || !wait) return;
    const done = track("local-busy");
    let waited = false;
    const pending = wait("local-busy", new AbortController().signal).then(value => { waited = value; });
    await Bun.sleep(5);
    expect(waited).toBe(false);
    done();
    await pending;
    expect(waited).toBe(true);
    expect(await wait("local-idle", new AbortController().signal)).toBe(false);
  });
});

describe("#498 several follow-ups in a row all go, in order", () => {
  test("a third message waits behind the second instead of being rejected", async () => {
    const queue = (continuation as Record<string, unknown>).queueContinuation as ((profile: string, session: string, signal: AbortSignal) => Promise<() => void>) | undefined;
    expect(typeof queue).toBe("function");
    if (!queue) return;
    const first = continuation.claimContinuation("default", "local-burst");
    expect(first).toBeDefined();
    const order: string[] = [];
    const second = queue("default", "local-burst", new AbortController().signal).then(release => { order.push("second"); return release; });
    const third = queue("default", "local-burst", new AbortController().signal).then(release => { order.push("third"); return release; });
    await Bun.sleep(5);
    expect(order).toEqual([]);
    first?.();
    const releaseSecond = await second;
    await Bun.sleep(5);
    expect(order).toEqual(["second"]);
    releaseSecond();
    (await third)();
    expect(order).toEqual(["second", "third"]);
    expect(continuation.claimContinuation("default", "local-burst")).toBeDefined();
  });

  test("an aborted waiter leaves the queue without blocking the next one", async () => {
    const queue = (continuation as Record<string, unknown>).queueContinuation as ((profile: string, session: string, signal: AbortSignal) => Promise<() => void>) | undefined;
    if (!queue) { expect(typeof queue).toBe("function"); return; }
    const first = continuation.claimContinuation("default", "local-abort");
    const abort = new AbortController();
    const gone = queue("default", "local-abort", abort.signal).then(() => "claimed", () => "aborted");
    const next = queue("default", "local-abort", new AbortController().signal);
    abort.abort();
    expect(await gone).toBe("aborted");
    first?.();
    (await next)();
  });
});
