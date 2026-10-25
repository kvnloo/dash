import { describe, expect, test } from "bun:test";
import type { AgentInfo, BotInfo, HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { botsTree, hostLabel } from "./bots-tree";
import { botFaceIdentity } from "./moodie-identity";
import { childNodes, type TreeNode } from "./tree";

const NOW = 2_000_000_000;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing synthetic tree node or fixture");
  return value;
}

function children(node: TreeNode | undefined): TreeNode[] {
  const result = childNodes(required(node));
  if (result instanceof Promise) throw new Error("botsTree children must be synchronous");
  return result;
}

interface Graph {
  hosts: HostInfo[];
  conversations: Conversation[];
  cwdReads(): number;
}

/**
 * The same profile/session IDs recur on different hosts deliberately: routing must
 * use targetHostId rather than treating a matching session ID as globally active.
 * All input objects/arrays are frozen so tree construction cannot mutate a roster.
 */
function syntheticGraph(hostCount: number, botsPerHost: number, sessionsPerBot: number): Graph {
  let reads = 0;
  const hosts: HostInfo[] = [];
  const conversations: Conversation[] = [];

  for (let h = 0; h < hostCount; h++) {
    const hostId = `host-${h}`;
    const online = h % 2 === 0;
    const agents: AgentInfo[] = [];
    const bots: BotInfo[] = [];

    for (let b = 0; b < botsPerHost; b++) {
      const profileId = `profile-${b}`;
      const agentId = `hermes:${profileId}`;
      agents.push({ id: agentId, name: `Profile ${b}`, kind: "hermes", profileId, status: "available" });
      const bot: BotInfo = {
        id: `bot-${b}`, name: `Bot ${b}`, runtime: "hermes",
        status: online ? "running" : "available", agentId,
        channels: [{ platform: "telegram", state: "connected" }],
      };
      Object.freeze(bot.channels[0]);
      Object.freeze(bot.channels);
      Object.freeze(bot);
      bots.push(bot);

      for (let s = 0; s < sessionsPerBot; s++) {
        const sessionId = `session-${b}-${s}`;
        const path = `/work/${hostId}/repo-${b}-${s}`;
        agents.push({
          id: sessionId, name: `Task ${b}.${s}`, kind: "hermes",
          status: "running", profileId, sessionId, lastActivityAt: NOW - 3_600_000,
          get cwd() { reads++; return path; },
        });
      }
    }

    agents.push({ id: `omp:installed-${h}`, name: "OMP", kind: "omp", status: "available" });
    for (const agent of agents) Object.freeze(agent);
    Object.freeze(agents);
    Object.freeze(bots);

    const host: HostInfo = {
      id: hostId, name: `Routing ${h}`, hostname: `  machine-${h}  `,
      online, self: h === 0, address: `100.0.0.${h}`, agents, bots,
    };
    Object.freeze(host);
    hosts.push(host);

    if (botsPerHost > 0 && sessionsPerBot > 0) {
      const messages: Conversation["messages"] = [{
        id: `reply-${h}`, role: "assistant", text: "", at: NOW - 100,
        state: "streaming", status: "Running bash", turnId: `turn-${h}`, seq: 1,
      }];
      Object.freeze(messages[0]);
      Object.freeze(messages);
      const chat: Conversation = {
        id: `chat-${h}`, harness: "hermes", title: "Active task",
        createdAt: 1, updatedAt: h + 1, targetHostId: hostId,
        sessionId: "session-0-0", profileId: "profile-0", messages,
      };
      Object.freeze(chat);
      conversations.push(chat);
    }
  }
  Object.freeze(hosts);
  Object.freeze(conversations);
  return { hosts, conversations, cwdReads: () => reads };
}

describe("botsTree performance-lane correctness guards", () => {
  test("small roster: labels, exact counts, fallback and source-defined activity buckets", () => {
    const activityAt = [NOW + 1_000, NOW - 59 * 60_000, NOW - 60 * 60_000, NOW - 1_440 * 60_000, undefined];
    const agents: AgentInfo[] = activityAt.map((at, i) => ({
      id: `agent-${i}`, kind: "codex", name: `Agent ${i}`,
      status: "available", sessionId: `session-${i}`, lastActivityAt: at,
    }));
    const live: HostInfo = {
      id: "routing-id", name: "Fallback", hostname: "  actual-name  ",
      online: true, self: true, bots: [], agents,
    };
    const offline: HostInfo = {
      id: "offline", name: "Fallback offline", hostname: "   ",
      online: false, self: false, agents: [],
    };
    const opened: string[] = [];
    const actions: string[] = [];
    const roots = botsTree([live, offline], (host, agent) => opened.push(`${host.id}:${agent.id}`), (host) => actions.push(host.id), NOW);

    expect(hostLabel(live)).toBe("actual-name");
    expect(hostLabel(offline)).toBe("Fallback offline");
    expect(roots.map(node => [node.id, node.label, node.meta, node.status, node.dimmed])).toEqual([
      ["host:routing-id", "actual-name", "0 bots · 5 chats", "running", false],
      ["host:offline", "Fallback offline", "0 chats", "offline", true],
    ]);
    expect(roots.every(node => typeof node.children === "function")).toBe(true);
    expect(opened).toEqual([]);
    expect(actions).toEqual([]);

    const harness = required(children(roots[0])[0]);
    expect([harness.id, harness.kind, harness.status, harness.meta]).toEqual([
      "routing-id:harness:codex", "harness", "available", "5 chats",
    ]);
    const sessions = children(harness);
    expect(sessions.map(node => node.id)).toEqual(activityAt.map((_, i) => `routing-id:session:agent-${i}`));
    expect(sessions.map(node => node.meta)).toEqual(["now", "59m", "1h", "1d", undefined]);
    expect(children(roots[1])).toEqual([{ id: "offline:empty", kind: "note", label: "Host offline" }]);
    expect(opened).toEqual([]);
    expect(actions).toEqual([]);
    required(sessions[2]).onPress?.();
    required(roots[0]).onLongPress?.();
    expect(opened).toEqual(["routing-id:agent-2"]);
    expect(actions).toEqual(["routing-id"]);
  });

  test("identical session/profile IDs never leak live activity between hosts", () => {
    const graph = syntheticGraph(2, 1, 1);
    const a = required(graph.hosts[0]);
    const b = required(graph.hosts[1]);
    const bOnline: HostInfo = { ...b, online: true };
    const completed: Conversation = {
      ...required(graph.conversations[0]),
      messages: [{ id: "done", role: "assistant", text: "Complete", at: NOW,
        state: "done", turnId: "finished", seq: 1 }],
    };
    const running = required(graph.conversations[1]);
    // Foreign running work is first: a careless unscoped .find picks it up.
    const roots = botsTree([a, bOnline], () => {}, () => {}, NOW, [running, completed]);
    const aBot = required(children(roots[0])[0]);
    const bBot = required(children(roots[1])[0]);
    const aSession = required(children(aBot)[0]);
    const bSession = required(children(bBot)[0]);

    expect(aBot.botFace).toEqual({ identity: botFaceIdentity("profile-0"), state: "done" });
    expect(bBot.botFace).toEqual({ identity: botFaceIdentity("profile-0"), state: "working" });
    expect(aSession.botFace?.state).toBe("done");
    expect(bSession.botFace?.state).toBe("working");
    expect(aSession.thinking?.phase).toBe("idle");
    expect(bSession.thinking?.phase).toBe("tool");

    const offline = botsTree([a, b], () => {}, () => {}, NOW, [running, completed]);
    const offlineBot = required(children(offline[1])[0]);
    const offlineSession = required(children(offlineBot)[0]);
    expect(offlineBot.botFace?.state).toBe("idle");
    expect(offlineBot.dimmed).toBe(true);
    expect(offlineSession.status).toBe("offline");
    expect(offlineSession.thinking?.phase).toBe("idle");
    expect(offlineSession.botFace?.state).toBe("idle");
    expect(offlineSession.dimmed).toBe(true);
  });

  /**
   * OPTIONAL TIMING RECIPE — NOT RUN on this ChatGPT lane.
   * From repo root:
   *   bun test app/src/lib/bots-tree.performance-lane.test.ts
   *   DASH_BOTS_TREE_PROFILE=1 bun test app/src/lib/bots-tree.performance-lane.test.ts
   * Exact large input: 24 hosts, 96 bots, 288 sessions, 24 conversations.
   * Small control above: 2 hosts, 0 bots, 5 sessions, 0 conversations.
   * Optional env flag prints root-construction and first-expansion durations
   * without asserting against wall-clock time; repeat on the target device
   * under a stable build for a useful comparison.
   * Large build: NOT RUN; first expansion: NOT RUN; phone: NOT RUN.
   */
  test("large frozen graph retains every ID and defers session/repo work to expansion", () => {
    const graph = syntheticGraph(24, 4, 3);
    const opens: Array<{ host: HostInfo; agent: AgentInfo }> = [];
    const actions: Array<{ host: HostInfo; bot?: BotInfo }> = [];
    const dateNow = Date.now;
    const setTimeoutOriginal = globalThis.setTimeout;
    const profile = process.env.DASH_BOTS_TREE_PROFILE === "1";
    const constructionStart = profile ? performance.now() : 0;
    const roots = botsTree(graph.hosts, (host, agent) => opens.push({ host, agent }),
      (host, bot) => actions.push({ host, bot }), NOW, graph.conversations);
    const constructionMs = profile ? performance.now() - constructionStart : 0;
    const expansionStart = profile ? performance.now() : 0;

    expect(roots).toHaveLength(24);
    expect(graph.cwdReads()).toBe(0);
    expect(Object.isFrozen(graph.hosts)).toBe(true);
    expect(Object.isFrozen(required(graph.hosts[0]).agents)).toBe(true);
    const allIds: string[] = [];
    let pickedSession: TreeNode | undefined;
    let pickedBot: TreeNode | undefined;

    for (let h = 0; h < 24; h++) {
      const host = required(graph.hosts[h]);
      const root = required(roots[h]);
      const expectedHostId = `host-${h}`;
      expect([root.id, root.label, root.meta, root.status, root.dimmed]).toEqual([
        `host:${expectedHostId}`, `machine-${h}`, "4 bots · 12 chats",
        host.online ? "running" : "offline", !host.online,
      ]);
      expect(typeof root.children).toBe("function");
      // Earlier hosts have already been expanded. Their cwd reads are retained.
      const readsFromExpandedHosts = h * 4 * 3;
      expect(graph.cwdReads()).toBe(readsFromExpandedHosts);
      allIds.push(root.id);
      const top = children(root);
      expect(top.map(node => node.id)).toEqual([
        ...Array.from({ length: 4 }, (_, b) => `${expectedHostId}:bot:bot-${b}`),
        `${expectedHostId}:harness:omp`,
      ]);
      // Opening a host must not materialize any bot's session/repo nodes.
      expect(graph.cwdReads()).toBe(readsFromExpandedHosts);
      allIds.push(...top.map(node => node.id));
      for (let b = 0; b < 4; b++) {
        const bot = required(top[b]);
        expect(bot.meta).toBe("3 chats");
        expect(bot.botFace).toEqual({
          identity: botFaceIdentity(`profile-${b}`),
          state: b === 0 && host.online ? "working" : "idle",
        });
        // Only this bot's expansion should read its three sessions' cwd values.
        expect(graph.cwdReads()).toBe(readsFromExpandedHosts + b * 3);
        const sessions = children(bot);
        expect(graph.cwdReads()).toBe(readsFromExpandedHosts + (b + 1) * 3);
        expect(sessions.map(node => node.id)).toEqual(
          Array.from({ length: 3 }, (_, s) => `${expectedHostId}:session:session-${b}-${s}`),
        );
        expect(sessions.map(node => node.status)).toEqual(
          Array.from({ length: 3 }, () => host.online ? "running" : "offline"),
        );
        expect(sessions.map(node => node.meta)).toEqual(["1h", "1h", "1h"]);
        allIds.push(...sessions.map(node => node.id));
        if (h === 10 && b === 2) {
          pickedSession = sessions[1];
          pickedBot = bot;
        }
      }
      const harness = required(top[4]);
      expect([harness.status, harness.meta]).toEqual([host.online ? "available" : "offline", "0 chats"]);
      const installed = children(harness);
      expect(installed.map(node => node.id)).toEqual([`${expectedHostId}:new:omp:installed-${h}`]);
      allIds.push(...installed.map(node => node.id));
    }
    const expansionMs = profile ? performance.now() - expansionStart : 0;
    if (profile) console.info(`botsTree 24 hosts / 96 bots / 288 sessions: build=${constructionMs.toFixed(2)}ms, expand=${expansionMs.toFixed(2)}ms (observational only)`);

    expect(allIds).toHaveLength(24 * (1 + 4 + 12 + 1 + 1));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(graph.cwdReads()).toBe(288);
    expect(opens).toEqual([]);
    expect(actions).toEqual([]);
    expect(children(pickedSession)).toEqual([{
      id: "host-10:repo:session-2-1", kind: "repo",
      label: "repo-2-1", detail: "/work/host-10/repo-2-1",
    }]);
    expect(graph.cwdReads()).toBe(290);

    required(pickedSession).onPress?.();
    expect(opens).toHaveLength(1);
    expect(opens[0]?.host).toBe(graph.hosts[10]);
    expect(opens[0]?.agent).toBe(graph.hosts[10]?.agents.find(agent => agent.id === "session-2-1"));
    required(roots[10]).onLongPress?.();
    required(pickedBot).onLongPress?.();
    expect(actions).toHaveLength(2);
    expect(actions[0]?.host).toBe(graph.hosts[10]);
    expect(actions[0]?.bot).toBeUndefined();
    expect(actions[1]?.host).toBe(graph.hosts[10]);
    expect(actions[1]?.bot).toBe(graph.hosts[10]?.bots?.[2]);
    expect(Date.now).toBe(dateNow);
    expect(globalThis.setTimeout).toBe(setTimeoutOriginal);
  });
});
