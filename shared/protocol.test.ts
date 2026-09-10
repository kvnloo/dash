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
