import { FactoryGuard, stripMentions } from "./factory";
import type { GateItem } from "../../../shared/gate";
import type { GateRemote } from "./executor";
import type { Rule } from "./store";
function isObject(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
export function object(v: unknown): Record<string, unknown> {
  if (!isObject(v)) throw new Error("Unexpected GitHub response");
  return v;
}
function string(v: unknown): string { if (typeof v !== "string") throw new Error("Missing GitHub field"); return v; }
export type Api = (path: string, method?: string, body?: Record<string, unknown>) => Promise<unknown>;
const conditional = new Map<string, { etag: string; value: unknown }>();
export const ghApi: Api = async (path, method = "GET", body) => {
  for (let attempt = 0; ; attempt++) {
    const args = ["gh", "api", "--include", "--method", method, path];
    const cached = method === "GET" ? conditional.get(path) : undefined;
    if (cached) args.push("-H", `If-None-Match: ${cached.etag}`);
    if (body) args.push("--input", "-");
    const proc = Bun.spawn(args, { stdin: body ? new Blob([JSON.stringify(body)]) : "ignore", stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    const match = out.match(/^HTTP\/\S+ (\d+)/);
    const status = match ? Number(match[1]) : 0;
    if (status === 304 && cached) return cached.value;
    if (code === 0) {
      const split = out.search(/\r?\n\r?\n/);
      const value = split < 0 ? out : out.slice(split).trim();
      const parsed: unknown = value ? JSON.parse(value) : null;
      const etag = out.match(/^etag:\s*(.+)$/im)?.[1]?.trim();
      if (method === "GET" && etag) conditional.set(path, { etag, value: parsed });
      return parsed;
    }
    if ((status === 403 || status === 429 || /HTTP (403|429)/.test(err)) && attempt < 2) {
      const retry = out.match(/^retry-after:\s*(\d+)/im);
      const reset = out.match(/^x-ratelimit-reset:\s*(\d+)/im);
      const wait = retry ? Number(retry[1]) * 1000 : reset ? Math.max(1000, Number(reset[1]) * 1000 - Date.now()) : 30000 * (attempt + 1);
      if (wait > 120000) throw new Error("GitHub rate limited; retry after the reset window. No write retried.");
      await Bun.sleep(wait); continue;
    }
    throw new Error(`GitHub request failed (${status || "transport"}); no automatic write retry. ${err.slice(0, 200)}`);
  }
};
const RULE_PATHS = ["CONTRIBUTING.md", ".github/CONTRIBUTING.md", "AGENTS.md", ".github/PULL_REQUEST_TEMPLATE.md", ".github/pull_request_template.md", "PULL_REQUEST_TEMPLATE.md"];
export class GitHubRemote implements GateRemote {
  constructor(readonly api: Api = ghApi, readonly guard: Pick<FactoryGuard, "preflight" | "authorized"> = new FactoryGuard(api)) {}
  async rules(repo: string): Promise<Rule[]> {
    const tree = object(await this.api(`repos/${repo}/git/trees/HEAD?recursive=1`));
    if (tree.truncated === true || !Array.isArray(tree.tree)) throw new Error("Contribution-rule tree truncated; manual policy review required");
    const paths = tree.tree.map(object).filter(e => typeof e.path === "string" && (RULE_PATHS.some(p => p.toLowerCase() === String(e.path).toLowerCase()) || /^\.github\/PULL_REQUEST_TEMPLATE\//i.test(e.path)) && e.type === "blob");
    const rules: Rule[] = [];
    for (const entry of paths) {
      const blob = object(await this.api(`repos/${repo}/git/blobs/${entry.sha}`));
      if (blob.encoding !== "base64" || typeof blob.content !== "string") throw new Error("Cannot decode target contribution rule");
      rules.push({ path: string(entry.path), text: Buffer.from(blob.content, "base64").toString("utf8") });
    }
    return rules.sort((a,b) => a.path.localeCompare(b.path));
  }
  private async pages(path: string): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    for (let page = 1; page <= 30; page++) {
      const v = await this.api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(v)) throw new Error("Expected paginated GitHub list");
      all.push(...v.map(object));
      if (v.length < 100) return all;
    }
    throw new Error("GitHub pagination safety bound exceeded; manual reconciliation required");
  }
  async check(i: GateItem): Promise<string> {
    await this.guard.preflight(i);
    const { repo, number, head_sha, head, base, title, comment_id } = i.target;
    const root = `repos/${repo}`;
    if (object(await this.api(root)).archived === true) return "Target repository is archived";
    if (i.kind === "push_branch") {
      if (!head || !head_sha || !/^[\w][\w./-]*$/.test(head) || head.includes("..") || !base) return "Branch creation requires safe head, base and pinned commit SHA";
      if (["main", "master", "dev", "nightly", base].includes(head)) return "Protected/default branch updates are forbidden";
      const refs = await this.pages(`${root}/git/matching-refs/heads/${encodeURIComponent(head)}`);
      if (refs.some(r => r.ref === `refs/heads/${head}`)) return "Target branch already exists; never overwrite";
      if (object(await this.api(`${root}/commits/${head_sha}`)).sha !== head_sha) return "Pinned commit is unavailable in target repository";
      return "";
    }
    if (i.kind === "pr_open") {
      if (!head || !head_sha || !base || !title) return "PR proposal needs title, head, base and pinned head SHA";
      const parts = head.split(":");
      if (parts.length !== 2 || !parts[0] || !parts[1]) return "PR head must be owner:branch";
      const sourceRepo = `${parts[0]}/${repo.split("/")[1]}`;
      if (object(await this.api(`repos/${sourceRepo}/commits/${encodeURIComponent(parts[1])}`)).sha !== head_sha) return "PR source head SHA changed";
      const existing = await this.pages(`${root}/pulls?state=all&head=${encodeURIComponent(head)}&base=${encodeURIComponent(base)}`);
      if (existing.length) return "A PR already exists for this head/base";
      return "";
    }
    if (!number) return "Target issue/PR number is required";
    const isPR = i.kind !== "issue_comment";
    const live = object(await this.api(`${root}/${isPR ? "pulls" : "issues"}/${number}`));
    if (live.state !== "open") return "Target issue/PR is no longer open";
    if (head_sha && (!isPR || object(live.head).sha !== head_sha)) return "Pinned head SHA changed or target is not a PR";
    if (i.kind === "pr_ready_for_review") return live.draft === true ? "" : "PR is already ready for review";
    const comments = await this.pages(`${root}/issues/${number}/comments`);
    if (isPR) comments.push(...await this.pages(`${root}/pulls/${number}/comments`), ...await this.pages(`${root}/pulls/${number}/reviews`));
    if (comments.some(c => typeof c.body === "string" && stripMentions(c.body) === i.body)) return "An identical comment/review is already present";
    if (i.kind === "pr_review_reply" && (!comment_id || !comments.some(c => c.id === comment_id))) return "Review parent comment is missing";
    return "";
  }
  async authorized(i: GateItem) { return this.guard.authorized(i); }
  async post(i: GateItem): Promise<string> {
    const t = i.target, root = `repos/${t.repo}`;
    if (i.kind === "pr_ready_for_review") {
      const pr = object(await this.api(`${root}/pulls/${t.number}`));
      const result = object(await this.api("graphql", "POST", { query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{url}}}", variables: { id: pr.node_id } }));
      return string(object(object(object(result.data).markPullRequestReadyForReview).pullRequest).url);
    }
    if (i.kind === "push_branch") {
      await this.api(`${root}/git/refs`, "POST", { ref: `refs/heads/${t.head}`, sha: t.head_sha });
      return `https://github.com/${t.repo}/tree/${t.head}`;
    }
    const path = i.kind === "pr_open" ? `${root}/pulls` : i.kind === "pr_review_reply" ? `${root}/pulls/${t.number}/comments/${t.comment_id}/replies` : `${root}/issues/${t.number}/comments`;
    const payload = i.kind === "pr_open" ? { title: t.title, head: t.head, base: t.base, body: i.body, draft: true, maintainer_can_modify: false } : { body: i.body };
    return string(object(await this.api(path, "POST", payload)).html_url);
  }
  async verify(i: GateItem, url: string): Promise<boolean> {
    const root = `repos/${i.target.repo}`;
    if (i.kind === "push_branch") return object(object(await this.api(`${root}/git/ref/heads/${i.target.head}`)).object).sha === i.target.head_sha;
    if (i.kind === "pr_ready_for_review") { const v = object(await this.api(`${root}/pulls/${i.target.number}`)); return v.draft === false && v.html_url === url; }
    const u = new URL(url);
    if (u.origin !== "https://github.com" || !u.pathname.startsWith(`/${i.target.repo}/`)) return false;
    const comment = u.hash.match(/^#(?:issuecomment|discussion_r)(\d+)$/);
    const path = comment ? `${root}/${i.kind === "pr_review_reply" ? "pulls" : "issues"}/comments/${comment[1]}` : `${root}/pulls/${u.pathname.split("/").at(-1)}`;
    const v = object(await this.api(path));
    return v.body === i.body && v.html_url === url;
  }
}
