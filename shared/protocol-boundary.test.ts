import { expect, test } from "bun:test";
import { type AgentInfo, type ServerMessage, parseClientMessage, parseServerMessage, parseHosts } from "./protocol";

test("Hermes session metadata and scoped history survive the wire boundary", () => {
  const agent = { id: "hermes:session:clean:owner", name: "Native title", kind: "hermes", status: "available", sessionId: "owner", profileId: "clean", lastActivityAt: 1700000000000, messageCount: 12, source: "local" };
  const host = { id: "host", name: "host", hostname: "host", self: true, online: true, agents: [agent] };
  expect(parseHosts([host])).toEqual([host]);
  for (const key of ["lastActivityAt", "messageCount"]) {
    for (const bad of ["12", null, NaN, Infinity]) expect(parseHosts([{ ...host, agents: [{ ...agent, [key]: bad }] }])).toBeUndefined();
  }
  expect(parseHosts([{ ...host, agents: [{ ...agent, source: 3 }] }])).toBeUndefined();
  const history = { type: "history", harness: "hermes", sessionId: "owner", hostId: "host", profileId: agent.id, messages: [{ id: "1", role: "assistant", text: "reply", at: 1700000000000 }] };
  expect(parseServerMessage(history)).toEqual(history);
  expect(parseServerMessage({ ...history, profileId: 42 })).toBeNull();
  expect(parseServerMessage({ ...history, hostId: [] })).toBeNull();
});

const clientExamples: { value: Record<string, unknown>; required: string[] }[] = [
  { value: { type: "chat", id: "turn", harness: "omp", text: "hello" }, required: ["id", "harness", "text"] },
  { value: { type: "voice_begin", id: "turn", harness: "omp", mime: "audio/m4a" }, required: ["id", "harness", "mime"] },
  { value: { type: "voice_chunk", id: "turn", data: "YQ==" }, required: ["id", "data"] },
  { value: { type: "voice_commit", id: "turn" }, required: ["id"] },
  { value: { type: "cancel", id: "turn" }, required: ["id"] },
  { value: { type: "history", harness: "omp", sessionId: "session" }, required: ["harness", "sessionId"] },
];

for (const { value, required } of clientExamples) {
  test(`client ${value.type} validates every required field independently`, () => {
    expect(parseClientMessage(value)).not.toBeNull();
    for (const key of required) {
      for (const bad of [undefined, null, 42, {}, []]) {
        expect(parseClientMessage({ ...value, [key]: bad })).toBeNull();
      }
    }
    if (value.type === "chat" || value.type === "voice_begin" || value.type === "history") {
      expect(parseClientMessage({ ...value, cwd: 42 })).toBeNull();
      if (value.type !== "history") expect(parseClientMessage({ ...value, sessionId: 42 })).toBeNull();
    }
  });
}

const serverExamples: (ServerMessage & Record<string, unknown>)[] = [
  { type: "session", id: "turn", seq: 1, sessionId: "session" },
  { type: "transcript", id: "turn", seq: 1, text: "hello" },
  { type: "delta", id: "turn", seq: 1, text: "hello" },
  { type: "status", id: "turn", seq: 1, text: "working" },
  { type: "done", id: "turn", seq: 1, exitCode: 0 },
  { type: "error", id: "turn", seq: 1, message: "failed" },
];
for (const value of serverExamples) {
  test(`server ${value.type} rejects malformed fields without accepting an alternate branch`, () => {
    expect(parseServerMessage(value)).toEqual(value);
    for (const key of Object.keys(value).filter(key => key !== "type")) {
      const invalid = typeof value[key] === "number" ? [undefined, null, "1", NaN, Infinity] : [undefined, null, 1, {}, []];
      for (const bad of invalid) expect(parseServerMessage({ ...value, [key]: bad })).toBeNull();
    }
  });
}

test("hello rejects malformed harness metadata rather than admitting partial executable identity", () => {
  const hello = { type: "hello", version: 1, host: "host", cwd: "/project", harnesses: [] };
  expect(parseServerMessage(hello)).not.toBeNull();
  for (const bad of [null, 1, {}, { id: "omp", available: true }, { id: 1, name: "OMP", available: true }, { id: "omp", name: 1, available: true }, { id: "omp", name: "OMP", available: "yes" }]) {
    expect(parseServerMessage({ ...hello, harnesses: [bad] })).toBeNull();
  }
});

test("roster parser rejects each malformed agent identity and preserves valid identity", () => {
  const agent: AgentInfo = { id: "profile:work", name: "work", kind: "hermes", status: "running", cwd: "/project", sessionId: "session" };
  const host = { id: "host", name: "host", hostname: "machine", online: true, self: true, agents: [agent] };
  expect(parseHosts([host])).toEqual([host]);
  for (const key of ["id", "name", "kind", "status", "cwd", "sessionId"]) {
    for (const bad of [null, 42, {}, []]) {
      expect(parseHosts([{ ...host, agents: [{ ...agent, [key]: bad }] }])).toBeUndefined();
    }
  }
  expect(parseHosts([{ ...host, agents: [null] }])).toBeUndefined();
});
