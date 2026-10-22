import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, sep } from "node:path";
import { redact } from "./reply-parts";
import { safeTraceTarget, type TraceArtifact, type TraceCheck, type TraceEvidence } from "../../shared/trace-evidence";

const MAX_TEXT = 256 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;
const secret = /(^|\/)(?:\.[^/]+|node_modules|hermes-home|credentials?|secrets?|tokens?|auth(?:\.json)?|config\.(?:json|ya?ml)|state\.db|.*\.(?:pem|key|p12|sqlite|db))(?:\/|$)/i;
const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".md": "text/plain", ".txt": "text/plain", ".json": "text/plain", ".log": "text/plain", ".csv": "text/plain" };
export function tracePath(path: string, roots: string[]): string | null {
  try {
    if (!isAbsolute(path) || path.includes("\0") || path.split(/[\\/]/).includes("..")) return null;
    const canonical = realpathSync(path);
    for (const root of roots) {
      const base = realpathSync(root), rel = relative(base, canonical);
      const lexical = relative(root, path);
      if (rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel) && lexical && !lexical.startsWith(`..${sep}`) && !isAbsolute(lexical) && !secret.test(rel) && !secret.test(lexical)) return canonical;
    }
  } catch { /* Unknown/missing roots never grant access. */ }
  return null;
}
/** Open once, compare inode and canonical path again, cap reads before allocating. */
export function readTraceBytes(path: string, roots: string[], max = MAX_TEXT): Uint8Array | null {
  const canonical = tracePath(path, roots);
  if (!canonical) return null;
  let fd: number | undefined;
  try {
    fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd), current = statSync(canonical);
    if (!st.isFile() || st.size > max || st.ino !== current.ino || st.dev !== current.dev || tracePath(path, roots) !== canonical) return null;
    const data = Buffer.alloc(Math.min(max + 1, st.size + 1));
    const count = readSync(fd, data, 0, data.length, 0);
    return count > max ? null : data.subarray(0, count);
  } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}
export function readTraceText(path: string, roots: string[]): string {
  const bytes = readTraceBytes(path, roots);
  return bytes ? new TextDecoder().decode(bytes) : "";
}
export async function readTraceArtifact(path: string, roots: string[]): Promise<Response | null> {
  const type = mime[extname(path).toLowerCase()];
  if (!type) return null;
  const bytes = readTraceBytes(path, roots, type.startsWith("image/") ? MAX_IMAGE : MAX_TEXT);
  if (!bytes) return null;
  // Image MIME must match actual bytes; no active HTML/SVG or mislabeled text.
  if (type === "image/png" && !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
  if (type === "image/jpeg" && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) return null;
  if (type === "image/webp" && !(new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP")) return null;
  return new Response(type.startsWith("image/") ? new Uint8Array(bytes).buffer : redact(new TextDecoder().decode(bytes)), { headers: { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" } });
}
function section(prompt: string, title: RegExp): string[] {
  let active = false;
  const out: string[] = [];
  for (const line of prompt.split("\n")) {
    if (title.test(line.replace(/^#+\s*/, "").trim())) { active = true; continue; }
    if (active && /^(?:#{1,6} |[A-Z][A-Z /_-]+:?$)/.test(line.trim())) break;
    if (active) { const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/); if (bullet?.[1]) out.push(bullet[1]); }
  }
  return out.slice(0, 100);
}
const intentCache = new Map<string, TraceEvidence>();
export function extractIntent(prompt: string, source: string, verbatim?: string): TraceEvidence {
  const sourceHash = createHash("sha256").update(prompt).digest("hex");
  const cacheKey = `${source}\0${sourceHash}\0${verbatim === undefined ? "block" : createHash("sha256").update(verbatim).digest("hex")}`;
  const cached = intentCache.get(cacheKey);
  if (cached) return structuredClone(cached);
  const lines = prompt.split("\n");
  const ownerIndex = lines.findIndex(l => /^\s*(?:#+\s*)?OWNER\b/i.test(l));
  const header = ownerIndex >= 0 ? lines[ownerIndex] ?? "" : "";
  const inline = header.replace(/^\s*(?:#+\s*)?OWNER(?:\s+(?:ASK|WORDS))?(?:\s*\([^)]*\))?\s*:?\s*/i, "");
  const body: string[] = [];
  if (ownerIndex >= 0 && !inline) for (const line of lines.slice(ownerIndex + 1)) {
    if (/^\s*(?:#{1,6}\s+|[A-Z][A-Z0-9 /_()-]{2,}(?::|\s+by\b|$))/.test(line) && !/^\s*\d+[.)]/.test(line)) break;
    body.push(line);
  }
  const owner = inline || body.join("\n");
  const quotes = [...owner.matchAll(/(?:^|\n)\s*(?:\d+[.)]\s*)?["“]([\s\S]*?)["”](?=\s*(?:\n|$))/g)].map(m => m[1] ?? "");
  const original = verbatim ?? (quotes.join("\n\n") || owner.trim());
  const quote = redact(original);
  const explicit = section(prompt, /^(?:ACCEPTANCE(?: CRITERIA| CHECKS)?|TESTS|VERIFICATION):?$/i);
  const build = prompt.match(/(?:^|\n)BUILD\s*\n([\s\S]*?)(?=\n[A-Z][A-Z /_-]+\s*\n|$)/)?.[1] ?? "";
  const declared = [...build.matchAll(/^([A-Z][.)]\s+.+)$/gm)].map(m => m[1] ?? "");
  const acceptance = (explicit.length ? explicit : declared).map(redact);
  const rules = section(prompt, /^CONSTRAINTS:?$/i).map(redact);
  const extracted: TraceEvidence = {
    quote, quoteRedacted: original !== quote,
    intent: { specVersion: "0.2", graphId: `trace:${sourceHash.slice(0, 24)}`, revision: 0, intentGraph: { nodes: [{ id: "owner-request", kind: "task", ports: [], capabilities: [] }], edges: [] }, policies: {}, constraints: { budgets: {}, termination: {}, goal: quote.split("\n")[0] || "Original owner request unavailable", acceptance, rules }, provenance: { sourceHash, source } },
    checks: acceptance.map((text, i) => ({ id: `check-${i + 1}`, text, status: "unknown", evidence: [] })), artifacts: [],
    warnings: [...(!original ? ["No verbatim OWNER section found; no request was invented."] : []), ...(!acceptance.length ? ["No explicit acceptance section; criteria require owner review."] : []), ...(!explicit.length && declared.length ? ["Checks copied verbatim from declared BUILD items; owner review of granularity required."] : []), "Extracted intent, not a compiled plan or Bend verdict."],
  };
  if (intentCache.size >= 256) { const oldest = intentCache.keys().next().value; if (oldest) intentCache.delete(oldest); }
  intentCache.set(cacheKey, extracted);
  return structuredClone(extracted);
}
export function validateChecks(checks: TraceCheck[], _report: string, receipts: unknown, available: (path: string) => boolean = () => false, sourceHash?: string): TraceCheck[] {
  return checks.map(check => {
    if (!Array.isArray(receipts)) return check;
    const receipt: unknown = receipts.find((r: unknown) => typeof r === "object" && r !== null && "checkId" in r && r.checkId === check.id);
    if (typeof receipt !== "object" || receipt === null || !("text" in receipt) || receipt.text !== check.text || !("status" in receipt) || !("evidence" in receipt) || !Array.isArray(receipt.evidence) || !receipt.evidence.length || !receipt.evidence.every((p: unknown) => typeof p === "string" && safeTraceTarget(p) && available(p))) return check;
    if (sourceHash !== undefined && (!("sourceHash" in receipt) || receipt.sourceHash !== sourceHash)) return check;
    if (receipt.status !== "pass" && receipt.status !== "fail") return check;
    return { ...check, status: receipt.status, evidence: receipt.evidence.filter((p: unknown): p is string => typeof p === "string") };
  });
}
export function discoverArtifacts(report: string): TraceArtifact[] {
  const matches = report.match(/https?:\/\/[^\s<>"'`]+|dash:\/\/[A-Za-z]+|\/(?:mnt|home|workspace)\/[^\s<>"'`),]+/g) ?? [];
  const artifacts: TraceArtifact[] = [];
  for (const raw of matches) {
    const target = raw.replace(/[.,;]+$/, "");
    if (!safeTraceTarget(target) || secret.test(target) || artifacts.some(a => a.target === target)) continue;
    const kind = target.startsWith("dash:") ? "dash" : /github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(target) ? "pr" : /github\.com\/[^/]+\/[^/]+\/commit\/[a-f0-9]+$/.test(target) ? "commit" : /^http/.test(target) ? "page" : /\.(png|jpe?g|webp)$/i.test(target) ? /story|sheet/i.test(target) ? "storyboard" : "image" : "file";
    artifacts.push({ kind, target, title: target.split("/").at(-1) || target });
    if (artifacts.length >= 64) break;
  }
  return artifacts;
}
export function createTraceHttpHandler(options: { authorize(request: Request): Promise<boolean>; collect(): Promise<unknown>; roots: string[] }) {
  let cache: unknown, at = 0, pending: Promise<unknown> | undefined;
  return async (request: Request): Promise<Response | null> => {
    const u = new URL(request.url);
    if (!["/trace/snapshot", "/trace/artifact"].includes(u.pathname)) return null;
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (!await options.authorize(request)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (u.pathname === "/trace/artifact") return await readTraceArtifact(u.searchParams.get("path") ?? "", options.roots) ?? json({ error: "artifact unavailable" }, 404);
    try {
      if (!cache || Date.now() - at > 15000) {
        pending ??= options.collect().finally(() => { pending = undefined; });
        cache = await pending; at = Date.now();
      }
      return json(cache);
    } catch { return json({ error: "trace unavailable" }, 503); }
  };
}
