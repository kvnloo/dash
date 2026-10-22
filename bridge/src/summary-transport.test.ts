import { expect, test } from "bun:test";
import { ThinkingSummarizer } from "./thinking-summary";
import { resolveRoles } from "./model-roles";
import { completeSummary, SUMMARY_DEADLINE_MS, unavailableSummary } from "./thinking-summary";
import { createOAuthSummaryTransport, SummaryTransportError } from "./summary-oauth";
import { TurnSummaries } from "./turn-summaries";
import { parseServerMessage } from "../../shared/protocol";
import { isSummaryFailure, parseSummary, summaryLabel, type SummaryInfo } from "../../shared/thinking-summary";

function helper(output: unknown, exit = 0) {
  let killed = 0, payload = "";
  const transport = createOAuthSummaryTransport(argv => {
    expect(argv[0]).toBe("python3"); expect(argv).toHaveLength(2);
    expect(argv[1]).toEndWith("/summary-oauth.py");
    return {
      stdin: { write(text) { payload = text; }, end() {} },
      stdout: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(output))); controller.close(); } }),
      exited: Promise.resolve(exit), kill() { killed++; },
    };
  });
  return { transport, killed: () => killed, payload: () => JSON.parse(payload) };
}
const model = "openai-codex/gpt-6-luna";
test("summary failure wire enum admits every safe code, rejects arbitrary provider diagnostics", () => {
  const summary = { blockId: "turn", kind: "turn", text: "Summary unavailable", model, durationMs: 0 };
  for (const unavailable of ["transport_unavailable", "credential_unavailable", "provider_unavailable", "invalid_response", "model_mismatch", "deadline", "aborted", "role_unavailable"]) {
    expect(isSummaryFailure(unavailable)).toBe(true);
    expect(parseSummary({ ...summary, unavailable })).toMatchObject({ unavailable });
  }
  for (const bad of [null, 42, {}, "PRIVATE raw diagnostic"]) expect(isSummaryFailure(bad)).toBe(false);
  for (const bad of [null, 42, {}, { ...summary, blockId: 42 }, { ...summary, text: 42 }, { ...summary, durationMs: NaN }, { ...summary, durationMs: Infinity }]) expect(parseSummary(bad)).toBeUndefined();
  for (const key of Object.keys(summary)) { const missing = { ...summary }; Reflect.deleteProperty(missing, key); expect(parseSummary(missing)).toBeUndefined(); }
});

test("degraded chip distinguishes timeout, missing auth, transport, role and cancellation", () => {
  expect(unavailableSummary(model, "deadline").text).toBe("Summary unavailable · @smol timed out");
  expect(unavailableSummary(model, "credential_unavailable").text).toBe("Summary unavailable · @smol sign-in required");
  expect(unavailableSummary(model, "transport_unavailable").text).toBe("Summary unavailable · @smol transport not configured");
  expect(unavailableSummary(model, "role_unavailable").text).toBe("Summary unavailable · @smol role not configured");
  expect(unavailableSummary(model, "aborted").text).toBe("Summary unavailable · @smol cancelled");
  expect(unavailableSummary(model, "provider_unavailable").text).toBe("Summary unavailable · @smol provider request failed");
});

test("OAuth transport passes only prompt and exact model over stdin", async () => {
  const fake = helper({ ok: true, model, text: "Planned a fix." });
  expect(await fake.transport(model, "$(not shell) synthetic", new AbortController().signal)).toBe("Planned a fix.");
  expect(fake.payload()).toEqual({ model, prompt: "$(not shell) synthetic" }); expect(fake.killed()).toBe(1);
});
test("OAuth transport safely classifies missing transport, credential, mismatch and invalid output", async () => {
  for (const [output, code] of [
    [{ ok: false, code: "credential_unavailable" }, "credential_unavailable"],
    [{ ok: false, code: "PRIVATE raw error" }, "provider_unavailable"],
    [{ ok: true, model: "other/model", text: "wrong" }, "model_mismatch"],
    [{ ok: true, model, text: "" }, "invalid_response"],
  ]) {
    const fake = helper(output);
    await expect(fake.transport(model, "synthetic", new AbortController().signal)).rejects.toMatchObject({ code });
    expect(fake.killed()).toBe(1);
  }
  const missing = createOAuthSummaryTransport(() => { throw new Error("ENOENT private path"); });
  await expect(missing(model, "synthetic", new AbortController().signal)).rejects.toMatchObject({ code: "transport_unavailable" });
});
test("OAuth abort kills a stalled child and pre-abort never spawns", async () => {
  let calls = 0, killed = 0;
  const transport = createOAuthSummaryTransport(() => {
    calls++;
    return { stdin: { write() {}, end() {} }, stdout: new ReadableStream<Uint8Array>(), exited: new Promise<number>(() => {}), kill() { killed++; } };
  });
  const abort = new AbortController();
  const run = transport(model, "synthetic", abort.signal); abort.abort();
  await expect(run).rejects.toMatchObject({ code: "aborted" }); expect(killed).toBeGreaterThan(0);
  await expect(transport(model, "synthetic", abort.signal)).rejects.toMatchObject({ code: "aborted" }); expect(calls).toBe(1);
});
test("unsupported configured provider is explicit and never forwarded", async () => {
  await expect(completeSummary("unknown/model", "synthetic", new AbortController().signal)).rejects.toMatchObject({ code: "transport_unavailable" });
});
test("enabled/disabled, role errors, output sanitization, assignment-aware cache", async () => {
  let calls = 0, assigned = model;
  const service = new ThinkingSummarizer(() => resolveRoles().map(row => row.role === "smol" ? { ...row, model: assigned } : row), async (_model, prompt) => {
    calls++; expect(prompt).not.toContain("sk-secret123");
    return "<think>hidden</think>Checked demo branch\nPlan next step\nthird line sk-secret123";
  });
  const sample = { ...input, text: "token=sk-secret123 Checked demo" };
  expect(await service.summarize({ ...sample, enabled: false })).toBeNull(); expect(calls).toBe(0);
  expect((await service.summarize(sample))?.text).toBe("Checked demo branch Plan next step");
  expect((await service.summarize(sample))?.cached).toBe(true); expect(calls).toBe(1);
  assigned = "anthropic/claude-haiku-4-5";
  expect((await service.summarize(sample))?.model).toBe(assigned); expect(calls).toBe(2);
  const broken = new ThinkingSummarizer(() => { throw new Error("bad private file"); });
  expect((await broken.summarize(input))?.unavailable).toBe("role_unavailable");
});
test("caller abort reaches inference, no failure cache, cloud deadline is realistic", async () => {
  expect(SUMMARY_DEADLINE_MS).toBe(12000);
  let calls = 0, observedAbort = false;
  const service = new ThinkingSummarizer(resolveRoles, (_model, _prompt, signal) => {
    calls++; signal.addEventListener("abort", () => { observedAbort = true; }); return new Promise<string>(() => {});
  });
  const abort = new AbortController(); const run = service.summarize({ ...input, signal: abort.signal }); abort.abort();
  expect((await run)?.unavailable).toBe("aborted"); expect(observedAbort).toBe(true);
  expect((await service.summarize({ ...input, signal: abort.signal }))?.unavailable).toBe("aborted"); expect(calls).toBe(1);
});
test("live summaries emit for the current block, throttle safely, and never emit stale closed-block results", async () => {
  const events: SummaryInfo[] = [];
  const service = new ThinkingSummarizer(resolveRoles, async () => "Checked demo");
  const tracker = new TurnSummaries("live-synthetic", service, summary => events.push(summary));
  tracker.reasoning("first"); await Bun.sleep(1);
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ kind: "live", blockId: "1", text: "Checked demo" });
  tracker.reasoning("second"); await Bun.sleep(1); expect(events).toHaveLength(1);
  tracker.cancel();

  for (const nextBlock of [false, true]) {
    const stale: SummaryInfo[] = [];
    const slow = new ThinkingSummarizer(resolveRoles, () => new Promise<string>(() => {}));
    const turn = new TurnSummaries(`stale-${nextBlock}`, slow, summary => stale.push(summary));
    turn.reasoning("old block"); turn.action("test demo");
    if (nextBlock) turn.reasoning("new block");
    await Bun.sleep(1); expect(stale).toEqual([]); turn.cancel();
  }
});

test("turn tracker cancels stale live and all inference on cancel", async () => {
  const events: SummaryInfo[] = [], signals: AbortSignal[] = [];
  const service = new ThinkingSummarizer(resolveRoles, (_model, _prompt, signal) => { signals.push(signal); return new Promise<string>(() => {}); });
  const tracker = new TurnSummaries("synthetic", service, summary => events.push(summary));
  tracker.reasoning("Checked demo branch"); tracker.action("bun test demo");
  expect(signals[0]?.aborted).toBe(true); tracker.cancel(); await tracker.finish();
  await Bun.sleep(5); expect(signals.every(signal => signal.aborted)).toBe(true); expect(events).toEqual([]);
});
test("degraded event survives wire parser with clear chip label, no bogus thought duration", async () => {
  const events: SummaryInfo[] = [];
  const service = new ThinkingSummarizer(resolveRoles, async () => { throw new SummaryTransportError("credential_unavailable"); });
  const tracker = new TurnSummaries("synthetic", service, summary => events.push(summary));
  tracker.reasoning("Checked demo branch"); await tracker.finish();
  const summary = events.at(-1);
  expect(summary?.unavailable).toBe("credential_unavailable");
  if (!summary) throw new Error("Missing degraded summary");
  expect(parseServerMessage({ type: "status", id: "synthetic", seq: 1, text: "", summary })).toMatchObject({ summary });
  expect(summaryLabel(summary)).toBe("Summary unavailable · @smol sign-in required");
  expect(parseSummary({ ...summary, unavailable: "raw private exception" })).toBeUndefined();
  expect(summaryLabel({ ...summary, unavailable: undefined, text: "Checked branch", durationMs: 2000 })).toBe("Thought 2 s · Checked branch");
});

const input = { chatId: "synthetic", blockId: "1", text: "Checked demo branch; planned a fix.", kind: "final", enabled: true } satisfies Parameters<ThinkingSummarizer["summarize"]>[0];
test("@smol fails closed with visible safe degradation, never calls tiny", async () => {
  const models: string[] = [];
  const service = new ThinkingSummarizer(resolveRoles, async model => { models.push(model); throw new Error("PRIVATE provider diagnostic"); });
  const result = await service.summarize(input);
  expect(models).toEqual(["openai-codex/gpt-6-luna"]);
  expect(result).toMatchObject({ model: "openai-codex/gpt-6-luna", unavailable: "provider_unavailable", cached: false });
  expect(result?.text).toContain("Summary unavailable");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
