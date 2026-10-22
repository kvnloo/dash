import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { collectTrace, traceRoots } from "../bridge/src/trace-collect";
import { readTraceBytes } from "../bridge/src/trace-http";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { parseTraceSnapshot } from "../app/src/trace/model";
const out = process.argv[2];
if (!out || !out.startsWith("/")) throw new Error("Pass an absolute PRIVATE output directory; never bundle or commit this snapshot");
const started = Date.now();
const collected = await collectTrace();
const proof = process.argv.includes("--proof");
const selected = collected.rows.filter(r => r.key === "run:20261021-trace-intent");
const imageRow = collected.rows.find(r => r.project === "Dash" && r.evidence?.artifacts.some(a => a.kind === "image" || a.kind === "storyboard"));
if (imageRow && !selected.includes(imageRow)) selected.push(imageRow);
const workers = selected.flatMap(r => r.workers);
const raw = proof ? { ...collected, rows: selected, read: "Captured real Dash run sample for MBP review, not a live host connection. Unknown is not acceptance.", stats: { ...collected.stats, workers: workers.length, live: workers.filter(w => w.status === "running").length, cut: workers.filter(w => w.status === "interrupted").length, calls: workers.reduce((n, w) => n + w.calls, 0) } } : collected;
const parsed = parseTraceSnapshot(raw);
mkdirSync(out, { recursive: true, mode: 0o700 });
writeFileSync(join(out, "snapshot.json"), JSON.stringify(raw), { mode: 0o600 });
writeFileSync(join(out, "capture.json"), JSON.stringify({ source: "native read-only groot collection", capturedAt: collected.generatedAt, fullRows: collected.rows.length, selectedRows: raw.rows.map(r => r.key), proofSubset: proof }), { mode: 0o600 });
const artifacts: { target: string; file: string; sha256: string }[] = [];
mkdirSync(join(out, "artifacts"), { recursive: true, mode: 0o700 });
for (const a of parsed.rows.flatMap(r => r.evidence?.artifacts ?? []).filter(a => a.kind === "image" || a.kind === "storyboard").slice(0, 6)) {
  const bytes = readTraceBytes(a.target, traceRoots(), 8 * 1024 * 1024);
  if (!bytes) continue;
  const sha256 = createHash("sha256").update(bytes).digest("hex"), file = `artifacts/${sha256}${extname(a.target)}`;
  writeFileSync(join(out, file), bytes, { mode: 0o600 });
  artifacts.push({ target: a.target, file, sha256 });
}
writeFileSync(join(out, "artifacts.json"), JSON.stringify(artifacts), { mode: 0o600 });
for (const row of parsed.rows) if (row.evidence) {
  const dir = join(out, "intents", row.key.replace(/[^A-Za-z0-9_-]/g, "_"));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "INTENT.json"), JSON.stringify(row.evidence.intent, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ privateOutput: resolve(out), rows: parsed.rows.length, contracts: parsed.rows.filter(r => r.evidence).length, elapsedMs: Date.now() - started }));
