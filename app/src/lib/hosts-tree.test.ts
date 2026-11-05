import { describe, expect, test } from "bun:test";
import type { AgentInfo, BotInfo, HostInfo } from "../../../shared/protocol";
import { hostsTree } from "./hosts-tree";
import type { TreeNode } from "./tree";

// Shaped like groot's real roster (Kevin, 2026-11-05: "four profiles, then six harnesses, then a hundred chats
// inside hermes"): Hermes profiles exposed as bots, other harnesses, and many persisted Hermes sessions.
const profiles = ["default", "clean", "ayo", "analyst"];
const hermesBots: BotInfo[] = profiles.map(p => ({ id: `hermes-bot:${p}`, name: p, runtime: "hermes", status: "running", channels: [], agentId: `hermes:${p}` }));
const serviceBot: BotInfo = { id: "opendots", name: "opendots", runtime: "service", status: "running", channels: [] };
const anchors: AgentInfo[] = profiles.map(p => ({ id: `hermes:${p}`, name: `Hermes ${p}`, kind: "hermes", status: "available" }));
const hermesChats: AgentInfo[] = Array.from({ length: 100 }, (_, i) => ({
  id: `hermes-session:${i}`, name: `chat ${i}`, kind: "hermes", status: "available", sessionId: `s${i}`,
  // Most chats belong to a bot profile; some to profiles that are not bots (hypothesis, network).
  profileId: [...profiles, "hypothesis", "network"][i % 6],
}));
const otherHarnesses: AgentInfo[] = ["claude", "codex", "omp", "opencode", "pi"].flatMap(kind => [
  { id: kind, name: kind, kind, status: "available" as const },
  { id: `${kind}:chat`, name: `${kind} chat`, kind, status: "running" as const, sessionId: `${kind}-1` },
]);
const groot: HostInfo = { id: "groot", name: "groot", hostname: "groot", kind: "computer", online: true, address: "100.113.138.100",
  agents: [...anchors, ...hermesChats, ...otherHarnesses], bots: [...hermesBots, serviceBot] } as HostInfo;

const tree = hostsTree([groot], () => {}, () => {}, 0)[0]!;
const kids = (node: TreeNode) => (typeof node.children === "function" ? node.children() : node.children ?? []) as TreeNode[];
const walk = (node: TreeNode): TreeNode[] => [node, ...kids(node).flatMap(walk)];

describe("hosts tree hierarchy", () => {
  test("a host lists only harnesses, never bots or chats beside them", () => {
    const level = kids(tree);
    expect(new Set(level.map(node => node.kind))).toEqual(new Set(["harness"]));
    expect(level.map(node => node.label).sort()).toEqual(["Claude Code", "Codex", "Hermes", "OpenCode", "Services", "omp", "pi"]);
  });

  test("Hermes lists only profiles, and every profile with chats appears once", () => {
    const hermes = kids(tree).find(node => node.label === "Hermes")!;
    const level = kids(hermes);
    expect(new Set(level.map(node => node.kind))).toEqual(new Set(["bot"]));
    const labels = level.map(node => node.label);
    expect([...labels].sort()).toEqual([...profiles, "hypothesis", "network"].sort());
    expect(new Set(labels.slice(0, 4))).toEqual(new Set(profiles)); // configured bots first
    expect(hermes.meta).toBe("6 profiles · 100 chats");
  });

  test("every level holds one kind of thing", () => {
    for (const node of walk(tree)) {
      const childKinds = new Set(kids(node).map(child => child.kind));
      expect(childKinds.size).toBeLessThanOrEqual(1);
    }
  });

  test("no chat is lost or shown twice", () => {
    const sessions = walk(tree).filter(node => node.kind === "session" && node.id.includes(":session:"));
    expect(sessions.length).toBe(105);
    expect(new Set(sessions.map(node => node.id)).size).toBe(105);
  });

  test("bots run by a service sit under that harness", () => {
    const service = kids(tree).find(node => node.label === "Services")!;
    expect(kids(service).map(node => node.label)).toEqual(["opendots"]);
  });
});
