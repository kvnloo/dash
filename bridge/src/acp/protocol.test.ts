import { expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage, parseHosts, type ServerMessage } from "../../../shared/protocol";

test("optional routing identity survives parsing without changing old messages", () => {
  const identity = { hostId: "remote-host", profileId: "research" };
  const chat = { type: "chat", id: "t", harness: "hermes", text: "hi", sessionId: "s", cwd: "/tmp", ...identity };
  expect(parseClientMessage(chat)).toMatchObject(chat);
  expect(parseClientMessage({ ...chat, profileId: 5 })).toBeNull();
  const session = { type: "session", id: "t", seq: 1, sessionId: "s", harnessId: "hermes", transport: "acp", ...identity };
  expect(parseServerMessage(session)).toMatchObject(session);
  expect(parseServerMessage({ ...session, hostId: 4 })).toBeNull();
  const status: ServerMessage = { type: "status", id: "t", seq: 2, text: "Editing", acp: { sessionId: "s", update: { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "Editing", status: "pending" } } };
  expect(parseServerMessage(status)).toEqual(status);
  expect(parseServerMessage({ ...status, acp: { sessionId: 5, update: {} } })).toBeNull();
  expect(parseServerMessage({ ...status, acp: { sessionId: "s", update: [] } })).toBeNull();
  expect(parseHosts([{ id: "h", name: "h", hostname: "h", self: false, online: true, agents: [{ id: "a", kind: "hermes", name: "a", status: "running", profileId: 3 }] }])).toBeUndefined();
});
