#!/usr/bin/env bun
// Import a reviewed, cached evidence snapshot. No GitHub writes or fresh searches.
import { GateStore } from "./src/gate/store";
import { object } from "./src/gate/github";
import { projectFor, registry } from "./src/gate/factory";
const path = Bun.argv[2];
if (!path) throw new Error("gate-seed <reviewed-snapshot.json>; see docs/upstream-gate.md");
const snapshot = object(await Bun.file(path).json());
if (!Array.isArray(snapshot.candidates)) throw new Error("Expected candidates[]");
const projects = registry(), store = new GateStore(process.env.DASH_GATE_DIR);
const results = [];
for (const raw of snapshot.candidates) {
  const row = object(raw);
  const p = projects.find(p => p.id === row.project);
  if (!p) throw new Error("Snapshot project missing from canonical registry");
  projectFor(p.project_repo, projects);
  const proposal = object(row.proposal), target = object(proposal.target);
  if (!Array.isArray(row.rules)) throw new Error("Snapshot rule evidence missing");
  const rules = row.rules.map(v => { const r = object(v); if (typeof r.path !== "string" || typeof r.text !== "string") throw new Error("Invalid rule"); return { path: r.path, text: r.text }; });
  const item = await store.propose({ ...proposal, target: { ...target, repo: p.project_repo } }, rules);
  const final = typeof row.stale_reason === "string" ? await store.stale(item.id, row.stale_reason) : item;
  results.push({ id: final.id, repo: final.target.repo, state: final.state, bulk: final.policy.bulk_ok, human: final.policy.requires_human_text, reason: final.reason });
}
console.log(JSON.stringify({ source_snapshot: path, registry_projects: projects.length, items: results }, null, 2));
