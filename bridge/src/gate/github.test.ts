import { test, expect } from "bun:test";
import { GitHubRemote, type Api } from "./github";
import { FactoryGuard, type Project } from "./factory";
import type { GateItem } from "../../../shared/gate";
const base: GateItem = { id: "00000000-0000-0000-0000-000000000000", kind: "pr_comment", intent: "existing_review", target: { repo: "example/project", number: 12, head_sha: "a".repeat(40) }, body: "Verified evidence.", evidence: [{ label: "receipt", url_or_path: "https://github.com/example/project/pull/12" }], origin: { agent: "fixture", session: "test", created_at: "2026-10-19T00:00:00Z" }, policy: { bulk_ok: true, requires_human_text: false, reason: "fixture", rules: [] }, state: "approved", trail: [] };
const guard = { preflight: async () => {}, authorized: async () => true };
function remote(overrides: Record<string, unknown>) {
  const api: Api = async path => {
    if (path in overrides) return overrides[path];
    if (path === "repos/example/project") return { archived: false };
    if (path === "repos/example/project/pulls/12") return { state: "open", head: { sha: "a".repeat(40) } };
    if (path.includes("per_page=100&page=")) return [];
    throw new Error("Unexpected fixture path: " + path);
  };
  return new GitHubRemote(api, guard);
}
test("GitHub drift checks stop archived, closed and changed-head targets", async () => {
  expect(await remote({ "repos/example/project": { archived: true } }).check(base)).toContain("archived");
  expect(await remote({ "repos/example/project/pulls/12": { state: "closed" } }).check(base)).toContain("no longer open");
  expect(await remote({ "repos/example/project/pulls/12": { state: "open", head: { sha: "b".repeat(40) } } }).check(base)).toContain("SHA changed");
});
test("GitHub checks all comment surfaces and paginated duplicates after mention strip", async () => {
  expect(await remote({ "repos/example/project/issues/12/comments?per_page=100&page=1": Array.from({length:100},() => ({body:"Other"})), "repos/example/project/issues/12/comments?per_page=100&page=2": [{ body: base.body }] }).check(base)).toContain("identical");
  expect(await remote({ "repos/example/project/pulls/12/comments?per_page=100&page=1": [{body:base.body}] }).check(base)).toContain("identical");
  expect(await remote({}).check({ ...base, kind: "pr_review_reply", target: { ...base.target, comment_id: 4 } })).toContain("parent");
});
test("draft PR creation is duplicate/head bound; branch creation never overwrites", async () => {
  const item: GateItem = { ...base, kind: "pr_open", target: { repo: "example/project", head: "kvnloo:work", head_sha: "a".repeat(40), base: "main", title: "Fix" } };
  const r = remote({ "repos/kvnloo/project/commits/work": {sha:"a".repeat(40)}, "repos/example/project/pulls?state=all&head=kvnloo%3Awork&base=main&per_page=100&page=1": [{}] });
  expect(await r.check(item)).toContain("already exists");
  expect(await r.check({ ...item, kind: "push_branch", target: {repo:"example/project", head:"main",base:"main",head_sha:"a".repeat(40)} })).toContain("forbidden");
});
test("review-first sweep blocks latest requested changes", async () => {
  const project: Project = { id: "p", project_repo: "example/project", coordination_repo: "kvnloo/project", promotion_queue_url: "https://github.com/kvnloo/project/issues/1", civ: {city_id:"oss:p"} };
  const api: Api = async path => {
    if (path.includes("/pulls?")) return [{number:12,user:{login:"kvnloo"},head:{user:{login:"kvnloo"},sha:"a".repeat(40)}}];
    if (path.endsWith("/pulls/12")) return {mergeable:true};
    if (path.includes("/reviews?")) return [{user:{login:"reviewer"},state:"CHANGES_REQUESTED"},{user:{login:"reviewer"},state:"COMMENTED"}];
    throw new Error("unexpected path");
  };
  await expect(new FactoryGuard(api, () => [project]).reviewFirst(project)).rejects.toThrow("CHANGES_REQUESTED");
});
test("canonical receipt write is read back and fails closed on changed body", async () => {
  const project: Project = { id:"p", project_repo:"example/project",coordination_repo:"kvnloo/project",promotion_queue_url:"https://github.com/kvnloo/project/issues/1",civ:{city_id:"oss:p"} };
  let posted = "";
  const api: Api = async (path,method,body) => {
    if (path.endsWith("/issues/1")) return {state:"open"};
    if (method === "POST") { posted=String(body?.body); return {id:9}; }
    if (path.endsWith("/comments/9")) return {body:posted,html_url:"https://github.com/kvnloo/project/issues/1#issuecomment-9"};
    return [];
  };
  const auth=await new FactoryGuard(api,()=>[project]).record(base,{approved_by:"synthetic owner",expires_at:new Date(Date.now()+60000).toISOString(),body_sha256:"hash",scope:"fixture only"});
  expect(auth.url).toContain("issuecomment-9"); expect(auth.receipt_sha256).toHaveLength(64); expect(posted).toContain('"kind":"decision"');
  const changed: Api = async (path, method, body) => path.endsWith("/comments/9") ? { body: "changed", html_url: "https://github.com/kvnloo/project/issues/1#issuecomment-9" } : api(path,method,body);
  await expect(new FactoryGuard(changed,()=>[project]).record(base,{approved_by:"synthetic owner",expires_at:new Date(Date.now()+60000).toISOString(),body_sha256:"hash",scope:"fixture only"})).rejects.toThrow("readback mismatch");
});
