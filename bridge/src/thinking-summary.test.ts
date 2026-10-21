import { expect, test } from "bun:test";
import { resolveRoles } from "./model-roles";
import { redact, ThinkingSummarizer } from "./thinking-summary";
import { TurnSummaries } from "./turn-summaries";
import { parseClientMessage, parseServerMessage } from "../../shared/protocol";
import type { SummaryInfo } from "../../shared/thinking-summary";

const input = { chatId: "chat", blockId: "block", text: "Checked the integration branch and chose a rebase.", kind: "live", enabled: true } satisfies Parameters<ThinkingSummarizer["summarize"]>[0];
test("summary toggle, 4-second throttle, final bypass, cache and chat isolation", async () => {
  let at = 10000, calls = 0;
  const service = new ThinkingSummarizer(resolveRoles, async () => { calls++; return "Checked the branch."; }, () => at);
  expect(await service.summarize({ ...input, enabled: false })).toBeNull();
  expect(await service.summarize({ ...input, text: " " })).toBeNull();
  expect(calls).toBe(0);
  expect((await service.summarize(input))?.cached).toBe(false);
  expect((await service.summarize(input))?.cached).toBe(true); expect(calls).toBe(1);
  expect(await service.summarize({ ...input, text: "new" })).toBeNull();
  at += 3999; expect(await service.summarize({ ...input, text: "new" })).toBeNull();
  at++; expect((await service.summarize({ ...input, text: "new" }))?.text).toBe("Checked the branch.");
  expect((await service.summarize({ ...input, text: "new final", kind: "final" }))?.text).toBe("Checked the branch.");
  expect((await service.summarize({ ...input, chatId: "private" }))?.cached).toBe(false);
  expect(calls).toBe(4);
});
test("smol failure uses tiny; no secret reaches either provider or output", async () => {
  const models: string[] = [];
  const service = new ThinkingSummarizer(resolveRoles, async (model, prompt) => {
    models.push(model); expect(prompt).not.toContain("sk-secret123");
    if (models.length === 1) throw new Error("unavailable");
    return "Verified branch\nignored line\nthird line sk-outputsecret";
  });
  const result = await service.summarize({ ...input, text: "token=sk-secret123 Check branch" });
  expect(models).toEqual(["openai-codex/gpt-6-luna", "local/qwen3-4b-q4km"]);
  expect(result?.text).toBe("Verified branch"); expect(result?.model).toBe("local/qwen3-4b-q4km");
  expect(redact("Bearer abcdef token=abcdef sk-secret123 ghp_secret123")).toBe("[REDACTED] [REDACTED] [REDACTED] [REDACTED]");
});
test("slow provider aborted at 750ms, tiny inside 1.5s; failures are not cached", async () => {
  let calls = 0;
  const service = new ThinkingSummarizer(resolveRoles, (model, _prompt, signal) => {
    calls++;
    if (model.startsWith("local/")) return Promise.resolve("Tiny summary");
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  });
  const at = performance.now();
  expect((await service.summarize(input))?.text).toBe("Tiny summary");
  expect(performance.now() - at).toBeLessThan(1500); expect(calls).toBe(2);
  const broken = new ThinkingSummarizer(resolveRoles, async () => { throw new Error("no service"); });
  expect(await broken.summarize({ ...input, kind: "final" })).toBeNull();
  expect(await broken.summarize({ ...input, kind: "final" })).toBeNull();
});
test("identical concurrent requests coalesce", async () => {
  let calls = 0;
  const service = new ThinkingSummarizer(resolveRoles, async () => { calls++; await Bun.sleep(5); return "Summary"; });
  const results = await Promise.all([service.summarize(input), service.summarize(input)]);
  expect(results[0]).toEqual(results[1]); expect(calls).toBe(1);
});
test("block final and turn include actions and do not emit stale live results", async () => {
  const summaries: SummaryInfo[] = [];
  const prompts: string[] = [];
  const service = new ThinkingSummarizer(resolveRoles, async (_model, prompt) => { prompts.push(prompt); return "Checked integration branch, chose rebase"; });
  const tracker = new TurnSummaries("id", service, summary => summaries.push(summary));
  tracker.reasoning("Check the integration branch."); tracker.action("git status"); tracker.reasoning("Use rebase.");
  await tracker.finish(); tracker.reasoning("ignored"); await tracker.finish();
  expect(summaries.filter(item => item.kind === "final").length).toBe(2);
  expect(summaries.at(-1)?.kind).toBe("turn");
  expect(prompts.at(-1)).toContain("Action: git status"); expect(prompts.at(-1)).toContain("Use rebase.");
});
test("protocol summary fields are validated and old status remains compatible", () => {
  const event = { type: "status", id: "t", seq: 1, text: "", summary: { blockId: "1", kind: "turn", text: "Checked branch", model: "local/test", durationMs: 42000 } } satisfies { type: "status"; id: string; seq: number; text: string; summary: SummaryInfo };
  expect(parseServerMessage(event)).toEqual(event);
  for (const [key, value] of Object.entries({ blockId: "", kind: "other", text: "x".repeat(281), model: 1, durationMs: -1 })) expect(parseServerMessage({ ...event, summary: { ...event.summary, [key]: value } })).toBeNull();
  expect(parseServerMessage({ ...event, acp: {} })).toBeNull();
  expect(parseServerMessage({ type: "status", id: "t", seq: 1, text: "Thinking" })).not.toBeNull();
  expect(parseClientMessage({ type: "chat", id: "t", harness: "omp", text: "hi", summariesEnabled: true })).toMatchObject({ summariesEnabled: true });
  expect(parseClientMessage({ type: "chat", id: "t", harness: "omp", text: "hi", summariesEnabled: "yes" })).toBeNull();
});
