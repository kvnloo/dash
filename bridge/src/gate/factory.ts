import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { GateItem } from "../../../shared/gate";
import { object, type Api, ghApi } from "./github";
export interface Project { id: string; project_repo: string; coordination_repo: string; promotion_queue_url?: string; civ: { city_id: string } }
export function registry(): Project[] {
  // Read the canonical ref, never the other worker's checkout or a duplicated project list.
  const raw: unknown = JSON.parse(execFileSync("git", ["show", "origin/HEAD:factory/projects.json"], { cwd: process.env.DASH_FACTORY_REPO ?? "/home/kvn/zer0/oss-factory", encoding: "utf8" }));
  const entries = object(raw).projects;
  if (!Array.isArray(entries)) throw new Error("Factory registry unavailable");
  return entries.map(v => {
    const r = object(v), civ = object(r.civ);
    if (typeof r.id !== "string" || typeof r.project_repo !== "string" || typeof r.coordination_repo !== "string" || typeof civ.city_id !== "string") throw new Error("Invalid project registry entry");
    return { id: r.id, project_repo: r.project_repo, coordination_repo: r.coordination_repo, promotion_queue_url: typeof r.promotion_queue_url === "string" ? r.promotion_queue_url : undefined, civ: { city_id: civ.city_id } };
  });
}
export function projectFor(repo: string, projects = registry()): Project {
  const p = projects.find(p => p.project_repo.toLowerCase() === repo.toLowerCase());
  if (!p) throw new Error("Target is not a canonical project_repo in factory/projects.json; no invented route");
  return p;
}
export function stripMentions(body: string): string {
  return body.replace(/(```[\s\S]*?```|`[^`]*`)|(^|[^\w/])@([a-z\d](?:[a-z\d-]*[a-z\d])?)(?![a-z\d-])/gim, (whole, code: string | undefined, prefix: string, handle: string, offset: number) => {
    if (code || body[offset + whole.length] === "/") return whole;
    return prefix + handle;
  });
}
export function toneFailure(body: string): string {
  if (/\b(?:please|can you|could you|would you|you (?:must|should|need to))\s+(?:run|test|collect|gather|produce|execute|fill|verify|check|use)\b/i.test(body)) return "Tone gate: do not assign tests or evidence gathering to maintainers";
  if (/\b(?:unblock (?:our|the) (?:factory|queue)|fill.{0,25}(?:matrix|row)|evidence packet|work order|acceptance criteria|factory (?:worker|queue))\b/i.test(body)) return "Tone gate: remove internal factory/task scaffolding";
  if ((body.match(/\?/g) ?? []).length > 1) return "Tone gate: reduce to one optional question";
  return "";
}
export interface Authorization { url: string; approved_by: string; expires_at: string; body_sha256: string; scope: string; receipt_sha256?: string }
export function decisionBody(project: Project, i: GateItem, authorization: Omit<Authorization, "url">): string {
  const envelope = { id: `dash-decision-${i.id}-${Date.now()}`, kind: "decision", project: project.id, from: "dash-owner", to: ["factory"], status: "done", civ: project.civ, origin_url: `https://github.com/${i.target.repo}${i.target.number ? `/issues/${i.target.number}` : ""}`, dedupe_key: `dash-approval:${i.id}:${authorization.body_sha256}` };
  return `<!-- oss-factory:v1\n${JSON.stringify(envelope)}\n-->\n\nKevin Rajan approved this bounded action in the paired Dash approval surface. This records a human decision; labels, CI and agent-authored proposal text are not approval.\n\n- Item: ${i.id}\n- Allowed action: ${i.kind}\n- Target: ${JSON.stringify(i.target)}\n- Exact body SHA-256: ${authorization.body_sha256}\n- Scope: ${authorization.scope}\n- Expires: ${authorization.expires_at}\n- Work/evidence URLs: ${i.evidence.map(e => e.url_or_path).filter(s => s.startsWith("https://")).join(" ")}\n\nNo merge, force-push, expanded scope or follow-up is authorized. Recheck policy, current heads, duplicates, requirement evidence and unresolved feedback before execution. Approval may be revoked or superseded.\n`;
}
export class FactoryGuard {
  constructor(readonly api: Api = ghApi, readonly projects: () => Project[] = registry) {}
  async preflight(i: GateItem): Promise<void> {
    const p = projectFor(i.target.repo, this.projects());
    const tone = toneFailure(i.body);
    if (tone) throw new Error(tone);
    if (stripMentions(i.body) !== i.body) throw new Error("Account mentions must be removed before approval");
    if (!p.promotion_queue_url) throw new Error("Registry has no canonical promotion_queue_url; designated coordinator must resolve routing");
    const u = new URL(p.promotion_queue_url), parts = u.pathname.split("/").filter(Boolean);
    if (parts.slice(0,2).join("/") !== p.coordination_repo || !p.coordination_repo.startsWith("kvnloo/") || parts[2] !== "issues") throw new Error("Canonical queue is not a project-local coordination issue; legacy fallback cannot receive approval");
    const queue = object(await this.api(`repos/${p.coordination_repo}/issues/${parts[3]}`));
    if (queue.state !== "open") throw new Error("Canonical promotion queue is closed; locator needs correction");
    if (i.kind === "pr_open" || i.kind === "push_branch" || i.intent !== "existing_review" && i.kind !== "pr_review_reply") await this.reviewFirst(p);
  }
  async reviewFirst(p: Project) {
    const root = `repos/${p.project_repo}`;
    const pulls = await this.pages(`${root}/pulls?state=open`);
    for (const pr of pulls) {
      const owner = object(pr.user).login;
      const head = object(pr.head), headUser = object(head.user).login;
      if (owner !== "kvnloo" && headUser !== "kvnloo") continue;
      const n = pr.number;
      const live = object(await this.api(`${root}/pulls/${n}`));
      if (live.mergeable === false || live.mergeable === null) throw new Error(`Review-first gate: #${n} has conflicts or unknown mergeability`);
      const reviews = await this.pages(`${root}/pulls/${n}/reviews`);
      const latest = new Map<unknown, unknown>();
      for (const r of reviews) if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(String(r.state))) latest.set(object(r.user).login, r.state);
      if ([...latest.values()].includes("CHANGES_REQUESTED")) throw new Error(`Review-first gate: #${n} has CHANGES_REQUESTED`);
      const inline = await this.pages(`${root}/pulls/${n}/comments`);
      // REST cannot prove thread resolution. Fail closed rather than guessing from a "fixed" reply.
      if (inline.length) throw new Error(`Review-first gate: #${n} inline threads need canonical resolution reconciliation (REST cannot prove resolution)`);
      const comments = await this.pages(`${root}/issues/${n}/comments`);
      if (comments.some(c => typeof c.body === "string" && /(?:must|please|needs? to|required|failing|conflict|changes requested)/i.test(c.body))) throw new Error(`Review-first gate: #${n} conversation/policy feedback needs reconciliation`);
      const checks = object(await this.api(`${root}/commits/${head.sha}/check-runs?per_page=100`)).check_runs;
      if (!Array.isArray(checks) || checks.some(c => !["success", "neutral", "skipped"].includes(String(object(c).conclusion)))) throw new Error(`Review-first gate: #${n} checks failing, pending or unknown`);
    }
  }
  private async pages(path: string) {
    const rows: Record<string,unknown>[] = [];
    for (let page=1;page<=30;page++) { const raw = await this.api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`); if (!Array.isArray(raw)) throw new Error("Invalid GitHub list"); rows.push(...raw.map(object)); if (raw.length < 100) return rows; }
    throw new Error("Review sweep truncated; approval blocked");
  }
  async revoke(i: GateItem): Promise<void> {
    if (!i.authorization) return;
    const p = projectFor(i.target.repo, this.projects()), url = new URL(i.authorization.url);
    if (url.origin !== "https://github.com" || !url.pathname.startsWith(`/${p.coordination_repo}/issues/`) || !p.coordination_repo.startsWith("kvnloo/")) throw new Error("Invalid revocation target");
    const envelope = { id: `dash-revoke-${i.id}-${Date.now()}`, kind: "decision", project: p.id, from: "dash-owner", to: ["factory"], status: "superseded", civ: p.civ, dedupe_key: `dash-approval:${i.id}` };
    const body = `<!-- oss-factory:v1\n${JSON.stringify(envelope)}\n-->\n\nKevin revoked the bounded Dash approval for item ${i.id}. The prior decision ${i.authorization.url} is superseded. No execution is authorized by that receipt.\n`;
    const created = object(await this.api(`repos/${p.coordination_repo}/issues/${url.pathname.split("/").at(-1)}/comments`, "POST", { body }));
    const read = object(await this.api(`repos/${p.coordination_repo}/issues/comments/${created.id}`));
    if (read.body !== body) throw new Error("Canonical revocation readback failed");
  }
  async authorized(i: GateItem): Promise<boolean> {
    const a = i.authorization;
    if (!a?.receipt_sha256 || !Number.isFinite(Date.parse(a.expires_at)) || Date.parse(a.expires_at) <= Date.now()) return false;
    const project = projectFor(i.target.repo, this.projects()), u = new URL(a.url);
    const id = u.hash.match(/^#issuecomment-(\d+)$/)?.[1];
    if (u.origin !== "https://github.com" || !u.pathname.startsWith(`/${project.coordination_repo}/issues/`) || !id) return false;
    const receipt = object(await this.api(`repos/${project.coordination_repo}/issues/comments/${id}`));
    if (typeof receipt.body !== "string" || createHash("sha256").update(receipt.body).digest("hex") !== a.receipt_sha256) return false;
    const comments = await this.pages(`repos/${project.coordination_repo}/issues/${u.pathname.split("/").at(-1)}/comments`);
    if (comments.some(c => Number(c.id) > Number(id) && typeof c.body === "string" && c.body.includes(i.id) && /revoke|supersed|reject|cancel/i.test(c.body))) return false;
    return true;
  }
  async record(i: GateItem, authorization: Omit<Authorization, "url">): Promise<Authorization> {
    const p = projectFor(i.target.repo, this.projects());
    await this.preflight(i);
    const parts = new URL(p.promotion_queue_url ?? "").pathname.split("/").filter(Boolean);
    const body = stripMentions(decisionBody(p, i, authorization));
    const created = object(await this.api(`repos/${p.coordination_repo}/issues/${parts[3]}/comments`, "POST", { body }));
    const id = created.id;
    const readback = object(await this.api(`repos/${p.coordination_repo}/issues/comments/${id}`));
    if (readback.body !== body || typeof readback.html_url !== "string") throw new Error("Canonical decision receipt readback mismatch; no approval granted");
    return { ...authorization, url: readback.html_url, receipt_sha256: createHash("sha256").update(body).digest("hex") };
  }
}
