import { expect, test } from "bun:test";
import type { AgentInfo, HistoryMessage, HostInfo } from "../../../shared/protocol";
import { hydrateLiveConversation, mergeLiveConversations, shouldRequestHistory } from "../lib/live-sessions";

const ID = "01J-DASH20-NATIVE";
const NOW = Date.parse("2026-10-25T10:30:00Z");
const CWD = "/home/paired/workspace/dash";

function pairedHost(cwd = CWD): HostInfo {
  return {
    id: "paired",
    name: "paired",
    hostname: "paired",
    online: true,
    self: true,
    agents: [{
      id: "omp:tern-42",
      name: "OMP",
      kind: "omp",
      status: "running",
      detail: cwd,
      cwd,
      sessionId: ID,
    }],
  };
}

test("#20: live OMP roster adopts one chat, requests history and hydrates without replacing its session", () => {
  const roster = [pairedHost()];
  const rows = mergeLiveConversations([], roster, NOW);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("No live chat");
  expect(row).toMatchObject({
    id: "live:omp:" + ID, harness: "omp", sessionId: ID, targetHostId: "paired",
    profileId: "omp:tern-42", cwd: CWD, stale: false, messages: [],
  });
  expect(mergeLiveConversations(rows, roster, NOW + 1)).toBe(rows);
  expect(shouldRequestHistory(row)).toBe(true);

  const history: HistoryMessage[] = [
    { id: "u1", role: "user", text: "continue this session", at: NOW - 2000 },
    { id: "a1", role: "assistant", text: "prior answer", at: NOW - 1000 },
  ];
  const hydrated = hydrateLiveConversation(row, history);
  expect(hydrated.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
    { role: "user", text: "continue this session" },
    { role: "assistant", text: "prior answer" },
  ]);
  expect(hydrated.messages[1]).toMatchObject({
    state: "done", turnId: "history:live:omp:" + ID + ":a1",
  });
  expect(hydrated.sessionId).toBe(ID);
  expect(hydrated.cwd).toBe(CWD);
  expect(shouldRequestHistory(hydrated)).toBe(false);
  expect(hydrateLiveConversation(hydrated, history)).toBe(hydrated);
});

test("#20: incomplete history keeps an identified live OMP conversation visible", () => {
  const rows = mergeLiveConversations([], [pairedHost()], NOW);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("Missing live chat");
  expect(row.sessionId).toBe(ID);
  expect(row.messages).toEqual([]);
  expect(shouldRequestHistory(row)).toBe(true);
  expect(hydrateLiveConversation(row, [])).toBe(row);
  expect(shouldRequestHistory(row)).toBe(true);
});

test("#20: foreign hosts and unknown harness ids cannot become local live chats", () => {
  const paired = pairedHost();
  const rogue: AgentInfo = {
    id: "cursor-cloud", name: "Cursor", kind: "cursor-cloud",
    status: "running", sessionId: "foreign",
  };
  const rows = mergeLiveConversations([], [
    { ...paired, agents: [...paired.agents, rogue] },
    { ...paired, id: "remote", self: false },
  ], NOW);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("Missing paired OMP chat");
  expect(row.harness).toBe("omp");
  expect(row.sessionId).toBe(ID);
  expect(shouldRequestHistory({ ...row, harness: "cursor-cloud" })).toBe(false);
  expect(mergeLiveConversations([], [{ ...paired, self: false }], NOW)).toEqual([]);
  expect(mergeLiveConversations([], [{ ...paired, online: false }], NOW)).toEqual([]);
});
