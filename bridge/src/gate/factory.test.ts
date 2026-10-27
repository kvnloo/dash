import { test, expect } from "bun:test";
import { projectFor, stripMentions, toneFailure, decisionBody, type Project } from "./factory";
import { derivePolicy } from "./store";
import type { GateItem } from "../../../shared/gate";

test("mentions stripped without damaging code or scoped packages; labor assignment blocked", () => {
  expect(stripMentions("Thanks @HarryMoss. `@literal` and @scope/package.")).toBe("Thanks HarryMoss. `@literal` and @scope/package.");
  expect(toneFailure("Could you run the Linux matrix for us?")).toContain("Tone gate");
  expect(toneFailure("Please fill our matrix.")).toContain("Tone gate");
  expect(toneFailure("The pinned branch passes the two checks. Thanks for the implementation.")).toBe("");
  expect(derivePolicy([{ path: "CONTRIBUTING.md", text: "Preserve human coauthor trailers during rebases. Write clear tests." }]).requires_human_text).toBe(false);
});
test("registry routing does not invent targets or queue locators", () => {
  const projects: Project[] = [{ id: "p", project_repo: "origin/p", coordination_repo: "kvnloo/p", civ: { city_id: "oss:p" } }];
  expect(projectFor("origin/p", projects).coordination_repo).toBe("kvnloo/p");
  expect(() => projectFor("another/p", projects)).toThrow("canonical");
  expect(projectFor("origin/p", projects).promotion_queue_url).toBeUndefined();
});
test("canonical decision preserves bounded scope and machine envelope; no worker text becomes approval", () => {
  const p: Project = { id: "p", project_repo: "origin/p", coordination_repo: "kvnloo/p", civ: { city_id: "oss:p" } };
  const i: GateItem = { id: "00000000-0000-0000-0000-000000000000", kind: "pr_comment", target: { repo: "origin/p", number: 3 }, body: "Prepared agent text", evidence: [{ label: "test", url_or_path: "https://github.com/origin/p/pull/3" }], origin: { agent: "hermes", session: "test", created_at: "2026-10-19T00:00:00Z" }, policy: derivePolicy([]), state: "pending", trail: [] };
  const body = decisionBody(p,i,{ approved_by: "Kevin Rajan via paired Dash", expires_at: "2026-10-20T00:00:00Z", body_sha256: "hash", scope: "One comment only" });
  expect(body).toContain('"kind":"decision"'); expect(body).toContain('"city_id":"oss:p"'); expect(body).toContain("One comment only"); expect(body).toContain("2026-10-20"); expect(body).not.toContain(i.body);
});
