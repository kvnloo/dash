/** Intent, observations and artifacts remain distinct. HOTL 0.2 is the AODL document. */
export type TraceCheck = { id: string; text: string; status: "pass" | "fail" | "unknown"; evidence: string[] };
export type TraceArtifact = { kind: "image" | "storyboard" | "file" | "pr" | "commit" | "page" | "dash"; title: string; target: string; preview?: string };
export type TraceIntent = {
  specVersion: "0.2"; graphId: string; revision: number;
  intentGraph: { nodes: { id: string; kind: "task"; ports: []; capabilities: [] }[]; edges: [] };
  policies: Record<string, unknown>;
  constraints: { budgets: Record<string, unknown>; termination: Record<string, unknown>; goal: string; acceptance: string[]; rules: string[] };
  provenance: { sourceHash: string; source: string };
};
export type TraceEvidence = { quote: string; quoteRedacted: boolean; intent: TraceIntent; checks: TraceCheck[]; artifacts: TraceArtifact[]; warnings: string[] };
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(s => typeof s === "string" && s.length <= 65536);
export function safeTraceTarget(target: string): boolean {
  if (target.startsWith("/")) return !target.includes("\0") && !target.split("/").includes("..");
  if (/^dash:\/\/(Trace|Lab|Settings|Approvals|Main)$/.test(target)) return true;
  try { const u = new URL(target); return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
}
export function parseTraceEvidence(value: unknown): TraceEvidence {
  if (!object(value) || typeof value.quote !== "string" || value.quote.length > 65536 || !object(value.intent) || !Array.isArray(value.checks) || !Array.isArray(value.artifacts) || !strings(value.warnings)) throw new Error("Invalid trace evidence");
  const d = value.intent;
  if (d.specVersion !== "0.2" || typeof d.graphId !== "string" || !Number.isInteger(d.revision) || d.revision !== 0 || !object(d.constraints) || !object(d.provenance) || typeof d.provenance.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(d.provenance.sourceHash) || typeof d.provenance.source !== "string" || !object(d.intentGraph) || !Array.isArray(d.intentGraph.nodes) || d.intentGraph.nodes.length !== 1 || !Array.isArray(d.intentGraph.edges) || d.intentGraph.edges.length || !object(d.policies)) throw new Error("Invalid HOTL trace intent");
  const n: unknown = d.intentGraph.nodes[0], c = d.constraints;
  if (!object(n) || n.kind !== "task" || typeof n.id !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(n.id) || !Array.isArray(n.ports) || n.ports.length || !Array.isArray(n.capabilities) || n.capabilities.length || typeof c.goal !== "string" || !strings(c.acceptance) || !strings(c.rules) || !object(c.budgets) || !object(c.termination)) throw new Error("Invalid trace constraints");
  if (value.checks.length > 100 || value.artifacts.length > 64) throw new Error("Trace evidence too large");
  const checks = value.checks.map((v: unknown): TraceCheck => {
    if (!object(v) || typeof v.id !== "string" || typeof v.text !== "string" || !strings(v.evidence) || !v.evidence.every(safeTraceTarget) || !["pass", "fail", "unknown"].includes(String(v.status))) throw new Error("Invalid trace check");
    const status = v.status === "pass" ? "pass" : v.status === "fail" ? "fail" : "unknown";
    if (status !== "unknown" && !v.evidence.length) throw new Error("Verdict has no receipt");
    return { id: v.id, text: v.text, status, evidence: v.evidence };
  });
  const artifacts = value.artifacts.map((v: unknown): TraceArtifact => {
    if (!object(v) || typeof v.title !== "string" || typeof v.target !== "string" || !safeTraceTarget(v.target) || (v.preview !== undefined && typeof v.preview !== "string")) throw new Error("Invalid trace artifact");
    const kind = ["image", "storyboard", "file", "pr", "commit", "page", "dash"].find(k => k === v.kind);
    if (!kind) throw new Error("Invalid artifact kind");
    return { kind: v.kind === "image" ? "image" : v.kind === "storyboard" ? "storyboard" : v.kind === "pr" ? "pr" : v.kind === "commit" ? "commit" : v.kind === "page" ? "page" : v.kind === "dash" ? "dash" : "file", title: v.title, target: v.target, ...(typeof v.preview === "string" ? { preview: v.preview.slice(0, 2000) } : {}) };
  });
  return { quote: value.quote, quoteRedacted: value.quoteRedacted === true, intent: { specVersion: "0.2", graphId: d.graphId, revision: 0, intentGraph: { nodes: [{ id: n.id, kind: "task", ports: [], capabilities: [] }], edges: [] }, policies: d.policies, constraints: { budgets: c.budgets, termination: c.termination, goal: c.goal, acceptance: c.acceptance, rules: c.rules }, provenance: { sourceHash: d.provenance.sourceHash, source: d.provenance.source } }, checks, artifacts, warnings: value.warnings };
}
export function traceVerdict(evidence?: TraceEvidence): "met" | "partly" | "unknown" | "failed" {
  if (!evidence?.checks.length) return "unknown";
  if (evidence.checks.some(c => c.status === "fail")) return "failed";
  if (evidence.checks.every(c => c.status === "pass")) return "met";
  return evidence.checks.some(c => c.status === "pass") ? "partly" : "unknown";
}
