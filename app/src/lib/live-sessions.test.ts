import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import {
  adoptSummary,
  conversationPreview,
  findLiveConversation,
  hydrateLiveConversation,
  liveConversationId,
  liveSessionTitle,
  mergeLiveConversations,
  shouldRequestHistory,
} from "./live-sessions";

const now = 1_700_000_000_000;

const liveOmp: HostInfo = {
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
      detail: "/home/you/workspace/dash",
      cwd: "/home/you/workspace/dash",
      sessionId: "01liveomp",
    },
    {
      id: "harness:codex",
      name: "Codex",
      kind: "codex",
      status: "available",
    },
    {
      id: "cursor-cloud",
      name: "Cursor",
      kind: "cursor-cloud",
      status: "running",
      sessionId: "cursor-secret",
    },
  ],
};

const groot: HostInfo = {
  id: "0",
  name: "0",
  hostname: "groot",
  online: true,
  self: false,
  agents: [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running", sessionId: "peer-sess" }],
};

describe("mergeLiveConversations", () => {
  test("a live OMP tab becomes a Conversation with harness omp and stable sessionId", () => {
    const conversations = mergeLiveConversations([], [liveOmp, groot], now);
    expect(conversations).toHaveLength(1);
    const chat = conversations[0]!;
    expect(chat.harness).toBe("omp");
    expect(chat.sessionId).toBe("01liveomp");
    expect(chat.id).toBe(liveConversationId("omp", "01liveomp"));
    expect(chat.title).toBe("dash");
    expect(chat.cwd).toBe("/home/you/workspace/dash");
    expect(chat.messages).toEqual([]);
  });

  test("opening the live row a second time does not mint another empty chat", () => {
    const first = mergeLiveConversations([], [liveOmp], now);
    const second = mergeLiveConversations(first, [liveOmp], now + 1);
    expect(second.filter((c) => c.sessionId === "01liveomp")).toHaveLength(1);
    expect(second).toBe(first);
    expect(findLiveConversation(second, { harness: "omp", sessionId: "01liveomp" })?.id).toBe(
      liveConversationId("omp", "01liveomp"),
    );
  });

  test("unknown harness ids fail closed even when they carry a sessionId", () => {
    const conversations = mergeLiveConversations([], [liveOmp], now);
    expect(conversations.some((c) => c.harness === "cursor-cloud")).toBe(false);
    expect(conversations.some((c) => c.sessionId === "cursor-secret")).toBe(false);
    expect(conversations.some((c) => c.sessionId === "peer-sess")).toBe(false);
  });

  test("keeps a phone-created chat that already owns the session", () => {
    const existing: Conversation[] = [
      {
        id: "phone-1",
        harness: "omp",
        title: "Ship chats",
        createdAt: now - 10,
        updatedAt: now - 10,
        sessionId: "01liveomp",
        messages: [{ id: "m1", role: "user", text: "hi", at: now - 10 }],
      },
    ];
    const merged = mergeLiveConversations(existing, [liveOmp], now);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "phone-1", title: "Ship chats", targetHostId: "mbp", profileId: "omp:aaa", stale: false });
    expect(merged[0]?.messages).toEqual(existing[0]?.messages);
  });

  test("still lists a live session when history is empty", () => {
    const [chat] = mergeLiveConversations([], [liveOmp], now);
    expect(chat).toBeDefined();
    expect(conversationPreview(chat!)).toBe("/home/you/workspace/dash");
    expect(liveSessionTitle({ name: "OMP", cwd: "/tmp/proj" })).toBe("proj");
  });

  test("hello hosts adopt live sessions in the app store", () => {
    const src = readFileSync(join(import.meta.dir, "../store/app.ts"), "utf8");
    expect(src).toContain("mergeLiveConversations");
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/ChatsPane.tsx"), "utf8");
    expect(pane).toContain("chatRow(item, harnessName, connectionStatus)");
    const chat = readFileSync(join(import.meta.dir, "../screens/ChatScreen.tsx"), "utf8");
    expect(chat).toContain("cwd: current.cwd");
  });

  test("a live OMP jsonl hydrates user and assistant turns after setActive", () => {
    const [listed] = mergeLiveConversations([], [liveOmp], now);
    expect(listed?.messages).toEqual([]);
    expect(shouldRequestHistory(listed)).toBe(true);
    const hydrated = hydrateLiveConversation(listed!, [
      { id: "u1", role: "user", text: "ship the live transcript", at: now - 20 },
      { id: "a1", role: "assistant", text: "opening the row shows this", at: now - 10 },
    ]);
    expect(hydrated.messages.map((m) => ({ role: m.role, text: m.text }))).toEqual([
      { role: "user", text: "ship the live transcript" },
      { role: "assistant", text: "opening the row shows this" },
    ]);
    expect(hydrated.sessionId).toBe("01liveomp");
    expect(conversationPreview(hydrated)).toBe("opening the row shows this");
    expect(hydrateLiveConversation(hydrated, [{ id: "u2", role: "user", text: "again", at: now }])).toBe(hydrated);
  });

  test("in-flight streaming turns keep attach; hydration does not mint a second chat", () => {
    const listed = mergeLiveConversations([], [liveOmp], now)[0]!;
    const streaming: Conversation = {
      ...listed,
      messages: [
        {
          id: "a-live",
          role: "assistant",
          text: "partial",
          at: now,
          state: "streaming",
          turnId: "turn-1",
          seq: 4,
        },
      ],
    };
    expect(shouldRequestHistory(streaming)).toBe(false);
    expect(
      hydrateLiveConversation(streaming, [{ id: "u1", role: "user", text: "hi", at: now }]),
    ).toBe(streaming);
    expect(shouldRequestHistory({ ...listed, harness: "cursor-cloud", sessionId: "cursor-secret" })).toBe(false);
  });

  test("setActive requests live history over the existing socket", () => {
    const app = readFileSync(join(import.meta.dir, "../store/app.ts"), "utf8");
    expect(app).toContain("hydrateLiveConversation");
    expect(app).toContain("applyLiveHistory");
    expect(app).toContain("shouldRequestHistory");
    const bridge = readFileSync(join(import.meta.dir, "../net/bridge.ts"), "utf8");
    expect(bridge).toContain('type: "history"');
    expect(bridge).toContain("applyLiveHistory");
    expect(bridge).not.toContain("cursor-cloud");
  });
});

describe("live host identity", () => {
  test("offline self hosts do not adopt stale running rows", () => {
    expect(mergeLiveConversations([], [{ ...liveOmp, online: false }], now)).toEqual([]);
  });
  test("another host's identical session does not shadow the paired host", () => {
    const remote: Conversation = { id: "remote-chat", harness: "omp", title: "remote", createdAt: now, updatedAt: now,
      targetHostId: "remote", profileId: "omp:aaa", sessionId: "01liveomp", messages: [] };
    const rows = mergeLiveConversations([remote], [liveOmp], now);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ targetHostId: "mbp", profileId: "omp:aaa", sessionId: "01liveomp" });
  });
});

test("live search matches the paired session rather than an identical remote session", () => {
  const local = mergeLiveConversations([], [liveOmp], now)[0];
  if (!local) throw new Error("Missing local live conversation");
  const remote = { ...local, id: "remote", targetHostId: "remote" };
  expect(findLiveConversation([remote, local], local)?.id).toBe(local.id);
});

/** The pre-index O(C × R) merge, kept as the reference the keyed merge must match. */
function referenceMerge(existing: Conversation[], hosts: HostInfo[], at: number): Conversation[] {
  const reported = hosts.flatMap(host => !host.self || !host.online ? [] : host.agents.filter(agent => agent.status !== "offline" && ["omp", "codex", "hermes", "claude", "grok"].includes(agent.kind) && agent.sessionId).map(agent => ({ host, agent })));
  let changed = false;
  const rows = existing.map(c => {
    if (!c.sessionId) return c;
    const matches = reported.filter(({ host, agent }) => agent.kind === c.harness && agent.sessionId === c.sessionId && (!c.targetHostId || host.id === c.targetHostId) && (!c.profileId || c.profileId === agent.id));
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) { if (c.stale && c.openIn === undefined) return c; changed = true; return { ...c, stale: true, openIn: undefined }; }
    const { host, agent } = match;
    const title = c.harness === "hermes" ? agent.name : c.title;
    const updatedAt = agent.lastActivityAt ?? c.updatedAt;
    if (c.stale === false && title === c.title && updatedAt === c.updatedAt && c.messageCount === agent.messageCount && c.targetHostId === host.id && c.profileId === agent.id && c.openIn === agent.openIn) return c;
    changed = true;
    return { ...c, stale: false, targetHostId: host.id, profileId: agent.id, profileName: agent.profileId, title, updatedAt, messageCount: agent.messageCount, cwd: agent.cwd ?? c.cwd, openIn: agent.openIn };
  });
  const adopted: Conversation[] = [];
  for (const { host, agent } of reported) {
    const sessionId = agent.sessionId;
    if (!sessionId || rows.some(c => c.harness === agent.kind && c.sessionId === sessionId && c.targetHostId === host.id && c.profileId === agent.id)) continue;
    const baseId = liveConversationId(agent.kind, sessionId);
    adopted.push({ id: agent.kind === "hermes" ? `${baseId}:${host.id}:${agent.profileId ?? agent.id}` : baseId, harness: agent.kind, title: liveSessionTitle(agent),
      createdAt: agent.lastActivityAt ?? at, updatedAt: agent.lastActivityAt ?? at, sessionId, cwd: agent.cwd, targetHostId: host.id, profileId: agent.id,
      profileName: agent.profileId, messageCount: agent.messageCount, stale: false, ...(agent.openIn ? { openIn: agent.openIn } : {}), messages: [] });
  }
  return adopted.length ? [...adopted, ...rows] : changed ? rows : existing;
}

describe("keyed merge", () => {
  test("matches the reference merge on varied rosters and conversations", () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const kinds = ["omp", "codex", "hermes", "cursor-cloud"];
    for (let round = 0; round < 60; round++) {
      const hosts: HostInfo[] = ["mbp", "0"].map((id, h) => ({ id, name: id, hostname: id, online: rand(5) > 0, self: h === 0 || rand(3) === 0,
        agents: Array.from({ length: rand(8) }, (_, i) => ({ id: `${kinds[rand(4)]}:${i}`, name: `agent ${i}`, kind: kinds[rand(4)] ?? "omp",
          status: (["running", "available", "offline"] as const)[rand(3)] ?? "running", sessionId: rand(6) ? `s${rand(5)}` : undefined,
          profileId: rand(2) ? "clean" : undefined, lastActivityAt: rand(2) ? now - rand(1000) : undefined, ...(rand(4) === 0 ? { openIn: "CLI" } : {}) })) }));
      const existing: Conversation[] = Array.from({ length: rand(6) }, (_, i) => ({ id: `c${i}`, harness: kinds[rand(4)] ?? "omp", title: `t${i}`, createdAt: now, updatedAt: now,
        sessionId: rand(5) ? `s${rand(5)}` : undefined, targetHostId: rand(2) ? ["mbp", "0"][rand(2)] : undefined, profileId: rand(2) ? `${kinds[rand(4)]}:${rand(8)}` : undefined,
        stale: rand(2) === 0, messages: [] }));
      expect(mergeLiveConversations(existing, hosts, now)).toEqual(referenceMerge(existing, hosts, now));
    }
  });

  test("chats.v1 adopts only running or host-held sessions and still reconciles the rest", () => {
    const host: HostInfo = { ...liveOmp, agents: [
      ...liveOmp.agents,
      { id: "av:codex:old", name: "archived", kind: "codex", status: "available", sessionId: "old" },
      { id: "av:codex:held", name: "held", kind: "codex", status: "available", sessionId: "held", openIn: "CLI" },
    ] };
    const opened: Conversation = { id: "live:codex:old", harness: "codex", title: "archived", createdAt: now, updatedAt: now, sessionId: "old", stale: true, messages: [] };
    const merged = mergeLiveConversations([opened], [host], now, { adopt: "live" });
    expect(merged.map(c => c.sessionId).sort()).toEqual(["01liveomp", "held", "old"]);
    expect(merged.find(c => c.sessionId === "old")).toMatchObject({ stale: false, targetHostId: "mbp" });
    expect(mergeLiveConversations([], [host], now).map(c => c.sessionId).sort()).toEqual(["01liveomp", "held", "old"]);
    expect(mergeLiveConversations([], [host], now, { adopt: "live" }).map(c => c.sessionId).sort()).toEqual(["01liveomp", "held"]);
  });

  test("a tapped summary adopts with the roster's conversation id; view-only ones are flagged", () => {
    const summary = { key: "mbp:omp:01liveomp", kind: "omp", sessionId: "01liveomp", hostId: "mbp", hostName: "mbp", agentId: "omp:aaa", title: "dash",
      cwd: "/home/you/workspace/dash", startedAt: now - 5, lastActivityAt: now, messageCount: 4, origin: "agentsview" as const, chatable: true };
    const adopted = adoptSummary(summary, now);
    expect(adopted).toMatchObject({ id: liveConversationId("omp", "01liveomp"), targetHostId: "mbp", profileId: "omp:aaa", openedAt: now, messages: [] });
    expect(adopted.viewOnly).toBeUndefined();
    expect(mergeLiveConversations([adopted], [liveOmp], now)).toHaveLength(1);
    const hermes = adoptSummary({ ...summary, kind: "hermes", profileId: "clean", agentId: "hermes:session:clean:x" }, now);
    expect(hermes.id).toBe(`${liveConversationId("hermes", "01liveomp")}:mbp:clean`);
    expect(hermes.profileName).toBe("clean");
    expect(adoptSummary({ ...summary, kind: "chatgpt", chatable: false }, now).viewOnly).toBe(true);
  });
});
