import type { MapNode, OrchestraMap } from "../lib/orchestra-map";

/** Explicitly labelled, local-only renderer evidence; never represents the owner's roster. */
export function orchestraMotionFixture(): OrchestraMap {
  const hostId = "fixture:groot";
  const host: MapNode = { id: hostId, hostId, label: "groot", kind: "host", state: "idle", thinking: { phase: "idle" } };
  const repo: MapNode = { id: "fixture:repo", hostId, label: "dash", kind: "repo", state: "idle", thinking: { phase: "idle" }, path: "/fixture/dash" };
  const labels = ["Orchestra UX", "Native trace", "GenUI", "Needs review", "Stalled", "Rollout", "Sessions", "Composer", "Evidence", "Typecheck", "Tests"];
  const chats: MapNode[] = labels.map((label, i) => ({ id: `fixture:chat:${i}`, hostId, label, kind: i >= 9 ? "subagent" : "chat", state: i === 3 ? "needs-you" : i === 4 ? "failing" : i < 3 || i >= 9 ? "live" : "idle", thinking: { phase: i === 3 ? "waiting-approval" : i < 3 || i >= 9 ? "thinking" : "idle" } }));
  return {
    nodes: [host, ...chats, repo],
    edges: [
      ...chats.filter(n => n.kind === "chat").map(n => ({ id: `hosted:${n.id}`, from: hostId, to: n.id, relation: "hosted", active: false } satisfies OrchestraMap["edges"][number])),
      ...chats.filter(n => n.kind === "subagent").map(n => ({ id: `delegated:${n.id}`, from: "fixture:chat:0", to: n.id, relation: "delegated", active: true } satisfies OrchestraMap["edges"][number])),
      { id: "fixture:touched", from: "fixture:chat:0", to: repo.id, relation: "touched", active: false },
    ],
  };
}
