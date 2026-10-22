import { expect, test } from "bun:test";
import { hermesProfileFor, sessionApprovals, sessionModelCommand } from "./agent-controls";
import type { GateItem } from "../../../shared/gate";
import { parseRecentModels, rankRecentModels } from "../../../shared/recent-models";
import { scrubIndex } from "./filter-gesture";
test("profile resolution preserves exact identity and rejects malformed or traversal tokens", () => {
  expect(hermesProfileFor({ harness: "hermes", profileId: "hermes:session:clean:abc" })).toBe("clean");
  expect(hermesProfileFor({ harness: "hermes", profileId: "hermes:default" })).toBe("default");
  expect(hermesProfileFor({ harness: "hermes", profileId: "hermes:session:%zz:abc" })).toBeUndefined();
  expect(hermesProfileFor({ harness: "hermes", profileId: "../clean" })).toBeUndefined();
  expect(hermesProfileFor({ harness: "omp", profileId: "clean" })).toBeUndefined();
});
test("recent model parser excludes cancelled providers, invalid counts and injected flags", () => {
  const rows = parseRecentModels([{ provider: "xai", model: "grok", count: 9 }, { provider: "nous", model: "anthropic/claude-opus-5.5", count: 2 }, { provider: "anthropic", model: "claude", count: -1 }, { provider: "openai-codex", model: "sol --global", count: 1 }]);
  expect(rows).toEqual([{ provider: "nous", model: "anthropic/claude-opus-5.5", count: 2 }]);
});
test("usage ranking combines only identical provider/model identities and constructs session-only native syntax", () => {
  const ranked = rankRecentModels([{ provider: "openai-codex", model: "gpt-6.1-sol", count: 2 }, { provider: "openai-codex", model: "gpt-6.1-sol", count: 3 }, { provider: "anthropic", model: "gpt-6.1-sol", count: 1 }]);
  expect(ranked.map(m => m.count)).toEqual([5, 1]);
  expect(sessionModelCommand(ranked[0]!)).toBe("/model gpt-6.1-sol --provider openai-codex --session");
  expect(sessionModelCommand({ provider: "xai", model: "grok", count: 1 })).toBeUndefined();
});
test("model scrub reuses filter geometry and clamps selection", () => {
  expect(scrubIndex(1, 40, 4)).toBe(2);
  expect(scrubIndex(1, -1000, 4)).toBe(0);
  expect(scrubIndex(1, 1000, 4)).toBe(3);
});
test("composer approval badge counts only the attached session's pending decisions", () => {
  const item = (id: string, session: string, state: GateItem["state"]): GateItem => ({
    id, kind: "pr_comment", target: { repo: "kvnloo/dash", number: 1 }, body: "b", evidence: [{ label: "e", url_or_path: "p" }],
    origin: { agent: "hermes", session, created_at: "2026-10-22T00:00:00Z" },
    policy: { bulk_ok: false, requires_human_text: false, reason: "", rules: [] }, state, trail: [],
  });
  const items = [item("a", "s1", "pending"), item("b", "s1", "edited"), item("c", "s1", "approved"), item("d", "s2", "pending")];
  expect(sessionApprovals(items, "s1").map(i => i.id)).toEqual(["a", "b"]);
  expect(sessionApprovals(items, "s2").map(i => i.id)).toEqual(["d"]);
  expect(sessionApprovals(items, undefined)).toEqual([]);
});
