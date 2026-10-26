import { describe, expect, test } from "bun:test";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseHosts,
  parseServerMessage,
} from "./protocol";

describe("PROTOCOL_VERSION", () => {
  test("is 1 so old phones still parse hello", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe("parseClientMessage", () => {
  test("accepts a typed chat turn", () => {
    expect(
      parseClientMessage({
        type: "chat",
        id: "t1",
        harness: "omp",
        text: "hi",
        cwd: "/home/you/workspace/dash",
      }),
    ).toEqual({
      type: "chat",
      id: "t1",
      harness: "omp",
      text: "hi",
      sessionId: undefined,
      cwd: "/home/you/workspace/dash",
    });
  });

  test("rejects a chat without text", () => {
    expect(parseClientMessage({ type: "chat", id: "t1", harness: "omp" })).toBeNull();
  });

  test("accepts voice begin / chunk / commit", () => {
    expect(parseClientMessage({ type: "voice_begin", id: "v1", harness: "omp", mime: "audio/m4a" })).toEqual({
      type: "voice_begin",
      id: "v1",
      harness: "omp",
      mime: "audio/m4a",
      sessionId: undefined,
      cwd: undefined,
    });
    expect(parseClientMessage({ type: "voice_chunk", id: "v1", data: "YQ==" })).toEqual({
      type: "voice_chunk",
      id: "v1",
      data: "YQ==",
    });
    expect(parseClientMessage({ type: "voice_commit", id: "v1" })).toEqual({ type: "voice_commit", id: "v1" });
  });

  test("accepts cancel and attach replay", () => {
    expect(parseClientMessage({ type: "cancel", id: "t1" })).toEqual({ type: "cancel", id: "t1" });
    expect(parseClientMessage({ type: "attach", turns: [{ id: "t1", seq: 3 }] })).toEqual({
      type: "attach",
      turns: [{ id: "t1", seq: 3 }],
    });
    expect(parseClientMessage({ type: "attach", turns: [{ id: "t1" }] })).toBeNull();
  });

  test("rejects unknown types and non-objects", () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage("chat")).toBeNull();
    expect(parseClientMessage({ type: "hello" })).toBeNull();
  });

  test("rejects chat when harness or id is the wrong type", () => {
    expect(parseClientMessage({ type: "chat", id: "t1", harness: 1, text: "hi" })).toBeNull();
    expect(parseClientMessage({ type: "chat", id: 1, harness: "omp", text: "hi" })).toBeNull();
    expect(parseClientMessage({ type: "chat", id: "t1", harness: "omp", text: "" })).toEqual({
      type: "chat",
      id: "t1",
      harness: "omp",
      text: "",
      sessionId: undefined,
      cwd: undefined,
    });
  });

  test("attach requires seq on every entry; empty turns is still attach", () => {
    expect(parseClientMessage({ type: "attach", turns: [] })).toEqual({ type: "attach", turns: [] });
    expect(parseClientMessage({ type: "attach", turns: [{ id: "t1", seq: "3" }] })).toBeNull();
    expect(parseClientMessage({ type: "attach" })).toBeNull();
  });

  test("accepts a live transcript request", () => {
    expect(parseClientMessage({ type: "history", harness: "omp", sessionId: "01liveomp" })).toEqual({
      type: "history",
      harness: "omp",
      sessionId: "01liveomp",
      cwd: undefined,
    });
    expect(
      parseClientMessage({
        type: "history",
        harness: "omp",
        sessionId: "01liveomp",
        cwd: "/home/you/workspace/dash",
      }),
    ).toEqual({
      type: "history",
      harness: "omp",
      sessionId: "01liveomp",
      cwd: "/home/you/workspace/dash",
    });
    expect(parseClientMessage({ type: "history", harness: "omp" })).toBeNull();
    expect(parseClientMessage({ type: "history", harness: 1, sessionId: "01liveomp" })).toBeNull();
  });
});

describe("parseServerMessage", () => {
  test("accepts hello without hosts (old bridges)", () => {
    const hello = parseServerMessage({
      type: "hello",
      version: 1,
      host: "mbp",
      cwd: "/home/you/workspace/dash",
      harnesses: [{ id: "omp", name: "OMP", available: true }],
    });
    expect(hello).toEqual({
      type: "hello",
      version: 1,
      host: "mbp",
      cwd: "/home/you/workspace/dash",
      harnesses: [{ id: "omp", name: "OMP", available: true }],
      hosts: undefined,
    });
  });

  test("accepts hello hosts and turn events", () => {
    const hosts = [
      {
        id: "mbp",
        name: "mbp",
        hostname: "mbp",
        online: true,
        self: true,
        agents: [{ id: "a2a:hermes", name: "Hermes", kind: "hermes", status: "running" as const }],
      },
    ];
    const hello = parseServerMessage({
      type: "hello",
      version: 1,
      host: "mbp",
      cwd: "/tmp",
      harnesses: [{ id: "omp", name: "OMP", available: false }],
      hosts,
    });
    expect(hello && hello.type === "hello" ? hello.hosts : undefined).toEqual(hosts);
    expect(parseServerMessage({ type: "delta", id: "t1", seq: 1, text: "ok" })).toEqual({
      type: "delta",
      id: "t1",
      seq: 1,
      text: "ok",
    });
    expect(parseServerMessage({ type: "done", id: "t1", seq: 2, exitCode: 0 })).toEqual({
      type: "done",
      id: "t1",
      seq: 2,
      exitCode: 0,
    });
    expect(parseServerMessage({ type: "lost", id: "t1" })).toEqual({ type: "lost", id: "t1" });
  });

  test("rejects a host with a bad agent status", () => {
    expect(
      parseHosts([
        {
          id: "mbp",
          name: "mbp",
          hostname: "mbp",
          online: true,
          self: true,
          agents: [{ id: "x", name: "X", kind: "omp", status: "maybe" }],
        },
      ]),
    ).toBeUndefined();
  });

  test("accepts optional harness sessionId on an agent", () => {
    const hosts = parseHosts([
      {
        id: "mbp",
        name: "mbp",
        hostname: "mbp",
        online: true,
        self: true,
        agents: [
          {
            id: "omp:aaa",
            name: "OMP",
            kind: "omp",
            status: "running",
            cwd: "/home/you/workspace/dash",
            sessionId: "01liveomp",
          },
        ],
      },
    ]);
    expect(hosts?.[0]?.agents[0]?.sessionId).toBe("01liveomp");
  });

  test("accepts a live transcript reply and ignores a bad message row", () => {
    expect(
      parseServerMessage({
        type: "history",
        harness: "omp",
        sessionId: "01liveomp",
        messages: [
          { id: "u1", role: "user", text: "ship chats", at: 1_700_000_000_000 },
          { id: "a1", role: "assistant", text: "opening the row", at: 1_700_000_000_100 },
        ],
      }),
    ).toEqual({
      type: "history",
      harness: "omp",
      sessionId: "01liveomp",
      messages: [
        { id: "u1", role: "user", text: "ship chats", at: 1_700_000_000_000 },
        { id: "a1", role: "assistant", text: "opening the row", at: 1_700_000_000_100 },
      ],
    });
    expect(
      parseServerMessage({
        type: "history",
        harness: "omp",
        sessionId: "01liveomp",
        messages: [{ id: "u1", role: "system", text: "nope", at: 1 }],
      }),
    ).toBeNull();
    expect(parseServerMessage({ type: "history", harness: "omp", sessionId: "01liveomp" })).toBeNull();
  });

  test("rejects a host when sessionId is not a string", () => {
    expect(
      parseHosts([
        {
          id: "mbp",
          name: "mbp",
          hostname: "mbp",
          online: true,
          self: true,
          agents: [{ id: "omp:aaa", name: "OMP", kind: "omp", status: "running", sessionId: 1 }],
        },
      ]),
    ).toBeUndefined();
  });
});

describe("Hermes handoff wire fields", () => {
  test("status carries a queued/sending handoff and rejects malformed ones", () => {
    const base = { type: "status" as const, id: "t", seq: 2, text: "Open in CLI on groot · reply queued until it closes" };
    expect(parseServerMessage({ ...base, handoff: { state: "queued", surface: "cli", host: "groot" } })).toEqual({ ...base, handoff: { state: "queued", surface: "cli", host: "groot" } });
    expect(parseServerMessage({ ...base, handoff: { state: "sending", surface: "cli", host: "groot" } })).toMatchObject({ handoff: { state: "sending" } });
    expect(parseServerMessage({ ...base, handoff: { state: "sent", surface: "cli", host: "groot" } })).toBeNull();
    expect(parseServerMessage({ ...base, handoff: { state: "queued", surface: 1, host: "groot" } })).toBeNull();
    expect(parseServerMessage({ ...base, handoff: "queued" })).toBeNull();
    expect(parseServerMessage({ ...base, handoff: { state: "queued", surface: "cli", host: "groot" }, acp: { sessionId: "s", update: {} } })).toBeNull();
    expect(parseServerMessage(base)).toEqual(base);
  });
  test("roster agents may say which live surface holds them", () => {
    const host = (openIn: unknown) => [{ id: "g", name: "g", hostname: "g", online: true, self: true, agents: [{ id: "hermes:session:clean:s", name: "Chat", kind: "hermes", status: "available", sessionId: "s", openIn }] }];
    expect(parseHosts(host("CLI"))?.[0]?.agents[0]?.openIn).toBe("CLI");
    expect(parseHosts(host(undefined))?.[0]?.agents[0]?.openIn).toBeUndefined();
    expect(parseHosts(host(3))).toBeUndefined();
  });
});

describe("chats.v1 additive ws fields", () => {
  const base = { type: "history", harness: "codex", sessionId: "c1" };
  test("history limit must be an integer 1..400", () => {
    for (const limit of [0, 401, 1.5, "50", -1]) expect(parseClientMessage({ ...base, limit })).toBeNull();
    expect(parseClientMessage({ ...base, limit: 50 })).toEqual({ type: "history", harness: "codex", sessionId: "c1", cwd: undefined, hostId: undefined, profileId: undefined, limit: 50 });
    expect(parseClientMessage({ ...base, limit: 400 })).toMatchObject({ limit: 400 });
  });
  test("history requestId is 1-64 safe chars", () => {
    expect(parseClientMessage({ ...base, limit: 50, requestId: "r-1_A" })).toMatchObject({ limit: 50, requestId: "r-1_A" });
    for (const requestId of ["", "has space", "x".repeat(65), "a/b", 7]) expect(parseClientMessage({ ...base, requestId })).toBeNull();
  });
  test("old-shape history parses unchanged (no new keys)", () => {
    const parsed = parseClientMessage(base);
    expect(parsed).toEqual({ type: "history", harness: "codex", sessionId: "c1", cwd: undefined, hostId: undefined, profileId: undefined });
    expect(parsed && "limit" in parsed).toBe(false);
    expect(parsed && "requestId" in parsed).toBe(false);
  });
  test("hello.features kept when string[] <= 32, dropped otherwise", () => {
    const hello = { type: "hello", version: 1, host: "h", cwd: "/", harnesses: [] };
    const read = (features: unknown) => { const m = parseServerMessage({ ...hello, features }); return m?.type === "hello" ? m.features : "not-hello"; };
    expect(read(["chats.v1"])).toEqual(["chats.v1"]);
    expect(read("chats.v1")).toBeUndefined();
    expect(read([1])).toBeUndefined();
    expect(read(Array.from({ length: 33 }, (_, i) => `f${i}`))).toBeUndefined();
    expect(read(undefined)).toBeUndefined();
  });
  test("history reply keeps requestId, before and truncated", () => {
    const reply = parseServerMessage({ type: "history", harness: "codex", sessionId: "c1", requestId: "r1", before: "abc", messages: [{ id: "av:1", role: "user", text: "x", at: 1, truncated: true }] });
    expect(reply).toMatchObject({ requestId: "r1", before: "abc", messages: [{ truncated: true }] });
    expect(parseServerMessage({ type: "history", harness: "codex", sessionId: "c1", before: null, messages: [] })).toMatchObject({ before: null });
    expect(parseServerMessage({ type: "history", harness: "codex", sessionId: "c1", before: 5, messages: [] })).toBeNull();
    expect(parseServerMessage({ type: "history", harness: "codex", sessionId: "c1", messages: [{ id: "a", role: "user", text: "x", at: 1, truncated: "yes" }] })).toBeNull();
  });
});
