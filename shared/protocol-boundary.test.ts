import { expect, test } from "bun:test";
import { type AgentInfo, type ServerMessage, type ClientMessage, type ChatSummary, type ChatSearchHit, parseClientMessage, parseServerMessage, parseHosts } from "./protocol";
import { CHAT_NAME, CURSOR_MAX_BYTES, MESSAGE_TEXT_MAX, decodeCursor, encodeCursor, parseChatListQuery, parseChatSummary, parseChatSearchPage } from "./protocol";

test("published chat bounds, names and cursor validation are stable", () => {
  expect(MESSAGE_TEXT_MAX).toBe(16000);
  expect(CURSOR_MAX_BYTES).toBe(4096);
  for (const name of ["0123456789", "a".repeat(64), "host:profile._-Z"]) expect(CHAT_NAME.test(name)).toBe(true);
  for (const name of ["", "a".repeat(65), "a/b", "a b"]) expect(CHAT_NAME.test(name)).toBe(false);
  expect(decodeCursor("")).toBeNull();
  expect(decodeCursor("A".repeat(4100))).toBeNull();
  expect(decodeCursor(encodeCursor({ n: 1 }))).toEqual({ n: 1 });
  expect(parseChatListQuery(new URLSearchParams("limit="))).toMatchObject({ limit: 50 });
  expect(parseChatListQuery(new URLSearchParams("limit=7"))).toMatchObject({ limit: 7 });
});

test("tool detail independent optional fields and empty approval snapshots fail closed", () => {
  const detail = { type: "tool_detail", id: "t", callId: "call", messageId: "m", sessionId: "s", profileId: "p", hostId: "h" } satisfies ClientMessage;
  expect(parseClientMessage(detail)).toEqual(detail);
  for (const key of ["id", "callId", "messageId", "sessionId", "profileId", "hostId"]) expect(parseClientMessage({ ...detail, [key]: 42 })).toBeNull();
  expect(parseServerMessage({ type: "gate_snapshot", items: [], dry_run: true })).toMatchObject({ type: "gate_snapshot", items: [] });
  expect(parseServerMessage({ type: "gate_snapshot", items: [{}], dry_run: true })).toBeNull();
});

test("chat summaries validate optional agent identity; search retains only declared roles", () => {
  const chat = { key: "h:hermes:s", kind: "hermes", sessionId: "s", hostId: "h", hostName: "Host", title: "Title", startedAt: 1, lastActivityAt: 2, messageCount: 3, origin: "hermes", chatable: true } satisfies ChatSummary;
  expect(parseChatSummary(chat)).toEqual(chat);
  for (const key of ["profileId", "agentId", "cwd", "openIn"]) expect(parseChatSummary({ ...chat, [key]: 42 })).toBeNull();
  for (const role of [undefined, "user", "assistant"] satisfies ChatSearchHit["role"][]) {
    const hit = { chat, field: "message", snippet: "text", highlights: [], ...(role ? { role } : {}) } satisfies ChatSearchHit;
    expect(parseChatSearchPage({ hits: [hit], next: null, partial: false })?.hits).toEqual([hit]);
  }
});

test("Hermes session metadata and scoped history survive the wire boundary", () => {
  const agent: AgentInfo = { id: "hermes:session:clean:owner", name: "Native title", kind: "hermes", status: "available", sessionId: "owner", profileId: "clean", lastActivityAt: 1700000000000, messageCount: 12, source: "local" };
  const host = { id: "host", name: "host", hostname: "host", self: true, online: true, agents: [agent] };
  expect(parseHosts([host])).toEqual([host]);
  for (const key of ["lastActivityAt", "messageCount"]) {
    for (const bad of ["12", null, NaN, Infinity]) expect(parseHosts([{ ...host, agents: [{ ...agent, [key]: bad }] }])).toBeUndefined();
  }
  expect(parseHosts([{ ...host, agents: [{ ...agent, source: 3 }] }])).toBeUndefined();
  const history: ServerMessage = { type: "history", harness: "hermes", sessionId: "owner", hostId: "host", profileId: agent.id, messages: [{ id: "1", role: "assistant", text: "reply", at: 1700000000000 }] };
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
