import { describe, expect, test } from "bun:test";
import type { HostInfo } from "../../../shared/protocol";
import type { TreeNode } from "./tree";
import {
  requestTargetSwitch,
  routeOf,
  sameTarget,
  targetBadgeText,
  targetSwitcherTree,
  targetSwitchProblem,
  targetTreeKey,
  type TargetRoute,
  type TargetSwitchIntent,
  type TargetSwitcherInventory,
} from "./target-switcher";

const local: HostInfo = {
  id: "paired",
  name: "Laptop",
  hostname: "laptop.tailnet",
  online: true,
  self: true,
  agents: [
    { id: "hermes:session:1", name: "Research", profileId: "default", kind: "hermes", status: "running", sessionId: "session|1", cwd: "/work/a" },
    { id: "hermes:session:2", name: "Review", profileId: "default", kind: "hermes", status: "available", sessionId: "session|2", cwd: "/work/b" },
    { id: "harness:omp", name: "OMP", kind: "omp", status: "available" },
  ],
};
const remote: HostInfo = {
  id: "remote",
  name: "Remote PC",
  hostname: "remote.tailnet",
  online: true,
  self: false,
  agents: [
    { id: "hermes:session:1", name: "Research", profileId: "default", kind: "hermes", status: "running", sessionId: "session|1", cwd: "/work/a" },
  ],
};
const route: TargetRoute = {
  hostId: "paired",
  harness: "hermes",
  profileId: "hermes:session:1",
  sessionId: "session|1",
  cwd: "/work/a",
};
const nextRoute: TargetRoute = {
  hostId: "paired",
  harness: "hermes",
  profileId: "hermes:session:2",
  sessionId: "session|2",
  cwd: "/work/b",
};
const change: TargetSwitchIntent = {
  kind: "model",
  route,
  modelId: "model/v2",
  providerId: "provider:one",
};

function inventory(): TargetSwitcherInventory {
  return {
    hosts: [local, remote],
    harnesses: [
      { id: "hermes", name: "Hermes", available: true },
      { id: "omp", name: "OMP", available: true },
    ],
    models: [
      { id: "model/v1", providerId: "provider:one", name: "Current LLM", hostId: "paired", harness: "hermes", profileId: route.profileId, sessionId: "session|1", selectable: true },
      { id: "model/v2", providerId: "provider:one", name: "Other LLM", hostId: "paired", harness: "hermes", profileId: route.profileId, sessionId: "session|1", selectable: true },
      { id: "model/v3", providerId: "provider:two", name: "Read-only", hostId: "paired", harness: "hermes", profileId: route.profileId, sessionId: "session|1", selectable: false, reason: "Host does not authorize changing this model." },
      { id: "model/v2", providerId: "provider:one", name: "Other remote", hostId: "remote", harness: "hermes", profileId: route.profileId, sessionId: "session|1", selectable: true },
    ],
    current: { ...route, modelId: "model/v1", providerId: "provider:one" },
  };
}

function descendants(nodes: readonly TreeNode[]): TreeNode[] {
  const all: TreeNode[] = [];
  for (const node of nodes) {
    all.push(node);
    if (Array.isArray(node.children)) all.push(...descendants(node.children));
  }
  return all;
}

describe("H-129 route identity and permission guards", () => {
  test("copies the full opaque host, agent, session and cwd without using cosmetic profileId", () => {
    const agent = local.agents[0];
    if (!agent) throw new Error("fixture missing agent");
    expect(routeOf(local, "hermes", agent)).toEqual(route);
    expect(sameTarget(routeOf(local, "hermes", agent), route)).toBe(true);
    expect(sameTarget({ ...route, hostId: "remote" }, route)).toBe(false);
    expect(sameTarget({ ...route, cwd: "/work/b" }, route)).toBe(false);
    expect(sameTarget({ ...route, sessionId: "session|2" }, route)).toBe(false);
  });

  test("uses collision-proof tuple IDs when opaque values contain separators", () => {
    expect(targetTreeKey("host", "a|b", "c")).not.toBe(targetTreeKey("host", "a", "b|c"));
    expect(targetTreeKey("host", "a:b", "c")).not.toBe(targetTreeKey("host", "a", "b:c"));
    expect(targetTreeKey("host", "a", "b")).not.toBe(targetTreeKey("profile", "a", "b"));
  });

  test("permits an exact reported session on the online paired host", () => {
    expect(targetSwitchProblem(inventory(), { kind: "target", route: nextRoute })).toBeUndefined();
    expect(targetSwitchProblem(inventory(), change)).toBeUndefined();
  });

  test("fails closed for remote routing, offline hosts and offline agents", () => {
    const data = inventory();
    expect(targetSwitchProblem(data, { kind: "target", route: { ...route, hostId: "remote" } }))
      .toContain("Pair directly");
    expect(targetSwitchProblem({ ...data, hosts: [{ ...local, online: false }, remote] }, { kind: "target", route }))
      .toContain("offline");
    const offline: HostInfo = { ...local, agents: local.agents.map(agent =>
      agent.id === route.profileId ? { ...agent, status: "offline" } : agent
    ) };
    expect(targetSwitchProblem({ ...data, hosts: [offline, remote] }, { kind: "target", route }))
      .toContain("offline");
  });

  test("rejects missing, ambiguous, malformed and stale identities", () => {
    const data = inventory();
    expect(targetSwitchProblem({ ...data, hosts: [local, local] }, { kind: "target", route }))
      .toContain("ambiguous");
    const duplicate = local.agents.find(agent => agent.id === route.profileId);
    if (!duplicate) throw new Error("fixture missing agent");
    expect(targetSwitchProblem({ ...data, hosts: [{ ...local, agents: [...local.agents, duplicate] }, remote] }, { kind: "target", route }))
      .toContain("ambiguous");
    expect(targetSwitchProblem(data, { kind: "target", route: { ...route, profileId: "default" } }))
      .toContain("missing or ambiguous");
    expect(targetSwitchProblem(data, { kind: "target", route: { ...route, sessionId: "unknown" } }))
      .toContain("missing or ambiguous");
    expect(targetSwitchProblem(data, { kind: "target", route: { ...route, cwd: "/other" } }))
      .toContain("directory changed");
    expect(targetSwitchProblem(data, { kind: "target", route: { ...route, hostId: " " } }))
      .toContain("Missing exact");
  });

  test("honors actual harness capability and does not assume installed means usable", () => {
    const data = inventory();
    expect(targetSwitchProblem({
      ...data,
      harnesses: [{ id: "hermes", name: "Hermes", available: false }],
    }, { kind: "target", route })).toContain("Harness is unavailable");
    expect(targetSwitchProblem({
      ...data,
      harnesses: [...data.harnesses, { id: "hermes", name: "Duplicate", available: true }],
    }, { kind: "target", route })).toContain("ambiguous");
  });

  test("requires a real native session before routing per-profile A2A and Hermes", () => {
    const data = inventory();
    const noSession: TargetRoute = { hostId: "paired", harness: "hermes", profileId: "hermes:profile" };
    const noSessionHost: HostInfo = { ...local, agents: [
      ...local.agents,
      { id: "hermes:profile", name: "Unbound profile", kind: "hermes", status: "available" },
      { id: "a2a:chief", name: "Chief", kind: "a2a", status: "running" },
    ] };
    const altered = { ...data, hosts: [noSessionHost, remote] };
    expect(targetSwitchProblem(altered, { kind: "target", route: noSession }))
      .toContain("requires an exact live session");
    expect(targetSwitchProblem(altered, { kind: "target", route: { hostId: "paired", harness: "hermes", profileId: "a2a:chief" } }))
      .toContain("A2A profile");
  });
});

describe("H-129 model change authority", () => {
  test("model requests are exact host + harness + profile + session + provider", () => {
    const data = inventory();
    expect(targetSwitchProblem(data, change)).toBeUndefined();
    expect(targetSwitchProblem(data, { ...change, providerId: "provider:unknown" }))
      .toContain("missing or ambiguous");
    expect(targetSwitchProblem(data, { ...change, route: nextRoute }))
      .toContain("missing or ambiguous");
    expect(targetSwitchProblem(data, { ...change, modelId: "missing" }))
      .toContain("missing or ambiguous");
    expect(targetSwitchProblem(data, { ...change, route: { ...route, hostId: "remote" } }))
      .toContain("Pair directly");
  });

  test("unavailable, duplicate and read-only model options never dispatch", () => {
    const data = inventory();
    expect(targetSwitchProblem({ ...data, models: [] }, change)).toContain("missing or ambiguous");
    const duplicate = data.models.find(model => model.id === change.modelId && model.hostId === route.hostId);
    if (!duplicate) throw new Error("fixture missing model");
    expect(targetSwitchProblem({ ...data, models: [...data.models, duplicate] }, change)).toContain("ambiguous");
    expect(targetSwitchProblem(data, { ...change, modelId: "model/v3", providerId: "provider:two" }))
      .toBe("Host does not authorize changing this model.");
    expect(targetSwitchProblem(data, { ...change, route: { hostId: "paired", harness: "omp", profileId: "harness:omp" } }))
      .toContain("exact session");
  });

  test("a callback receives exact identity only after validation and cannot mutate current optimistically", async () => {
    const data = inventory();
    const sent: TargetSwitchIntent[] = [];
    const before = JSON.stringify(data.current);
    const result = await requestTargetSwitch(data, change, intent => {
      sent.push(intent);
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(sent).toEqual([change]);
    expect(JSON.stringify(data.current)).toBe(before);
  });

  test("invalid switches never call the host and rejected or thrown switches preserve the session", async () => {
    const data = inventory();
    let called = 0;
    const invalid = await requestTargetSwitch(data, {
      kind: "target", route: { ...route, hostId: "remote" },
    }, () => {
      called++;
      return { ok: true };
    });
    expect(invalid.ok).toBe(false);
    expect(called).toBe(0);

    const refused = await requestTargetSwitch(data, change, () => {
      called++;
      return { ok: false, reason: "Busy session" };
    });
    expect(refused).toEqual({ ok: false, reason: "Busy session" });
    const unavailable = await requestTargetSwitch(data, change, () => {
      called++;
      throw new Error("Do not leak provider secrets");
    });
    expect(unavailable).toEqual({ ok: false, reason: "Switch failed. Your existing session is unchanged." });
    expect(called).toBe(2);
    expect(data.current).toEqual({ ...route, modelId: "model/v1", providerId: "provider:one" });
  });
});

describe("H-129 compact badge and drill-down tree", () => {
  test("labels unknown model truthfully, without inventing defaults", () => {
    const data = inventory();
    const current = data.current;
    if (!current) throw new Error("fixture missing current");
    expect(targetBadgeText({ ...data, current: { ...current, modelId: undefined, providerId: undefined } }).primary)
      .toContain("Model unknown");
    expect(targetBadgeText({ ...data, current: undefined }).primary).toBe("Choose target");
    const badge = targetBadgeText(data);
    expect(badge.primary).toBe("Hermes · Current LLM");
    expect(badge.secondary).toContain("Laptop / default / session|1");
    expect(badge.accessibilityLabel).toContain("profile default, session session|1, model Current LLM");
  });

  test("preserves the full long session ID in accessibility while compacting the badge", () => {
    const data = inventory();
    const current = data.current;
    if (!current) throw new Error("fixture missing current");
    const fullId = "native-session-9e3b4990b0b6499bba80629a";
    const badge = targetBadgeText({ ...data, current: { ...current, sessionId: fullId } });
    expect(badge.secondary).not.toContain(fullId);
    expect(badge.accessibilityLabel).toContain(fullId);
  });

  test("shows all five levels and distinct full session IDs under the correct host", () => {
    const data = inventory();
    const events: TargetSwitchIntent[] = [];
    const tree = targetSwitcherTree(data, intent => events.push(intent));
    const rows = descendants(tree.nodes);
    expect(rows.some(row => row.kind === "host" && row.label === "Laptop")).toBe(true);
    expect(rows.some(row => row.kind === "harness" && row.label === "Hermes")).toBe(true);
    expect(rows.some(row => row.label === "Profile · default")).toBe(true);
    expect(rows.some(row => row.label === "Research" && row.detail === "session|1")).toBe(true);
    expect(rows.some(row => row.label === "Review" && row.detail === "session|2")).toBe(true);
    expect(rows.some(row => row.label === "Model · Other LLM")).toBe(true);
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    expect(tree.initialExpanded.length).toBe(4);

    const review = rows.find(row => row.kind === "session" && row.label === "Review");
    expect(review?.onPress).toBeFunction();
    review?.onPress?.();
    expect(events).toEqual([{ kind: "target", route: nextRoute }]);

    const model = rows.find(row => row.label === "Model · Other LLM");
    expect(model?.onPress).toBeFunction();
    model?.onPress?.();
    expect(events[1]).toEqual(change);
  });

  test("current model stays non-actionable; remote, readonly and offline rows cannot route", () => {
    const data = inventory();
    const events: TargetSwitchIntent[] = [];
    const rows = descendants(targetSwitcherTree(data, intent => events.push(intent)).nodes);
    expect(rows.find(row => row.label === "Model · Current LLM")?.onPress).toBeUndefined();
    expect(rows.find(row => row.label === "Model · Read-only")?.onPress).toBeUndefined();
    expect(rows.find(row => row.label === "Model · Other remote")?.onPress).toBeUndefined();
    const remoteSession = rows.find(row => row.label === "Research" && row.detail?.includes("Pair directly"));
    expect(remoteSession?.onPress).toBeUndefined();
    const host = rows.find(row => row.kind === "host" && row.label === "Remote PC");
    expect(host?.detail).toContain("pair directly");
    expect(events).toEqual([]);
  });

  test("no reports or models produce honest, navigable empty leaves", () => {
    const data = inventory();
    const empty = targetSwitcherTree({ ...data, hosts: [], models: [] }, () => {});
    expect(empty.nodes[0]?.label).toBe("No hosts reported");
    const rows = descendants(targetSwitcherTree({ ...data, models: [] }, () => {}).nodes);
    expect(rows.some(row => row.label === "No session-scoped model choices")).toBe(true);
    expect(rows.some(row => row.label === "Open a session to view models")).toBe(true);
  });
});
