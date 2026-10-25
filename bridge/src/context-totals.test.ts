import { expect, test } from "bun:test";
import { harnessTotal, parseHarnessTotal } from "./context-totals";
test("Codex totals use last request, never lifetime or cached-input double counting", () => {
  const text = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 90000000 }, last_token_usage: { input_tokens: 604100, cached_input_tokens: 500000, output_tokens: 50 }, model_context_window: 1000000 } } });
  expect(parseHarnessTotal("codex", text, "s")).toMatchObject({ used: 604150, maximum: 1000000, categories: [], threshold: 0 });
  expect(parseHarnessTotal("codex", JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 90000000 } } } }), "s")).toBeUndefined();
});
test("Claude and OMP last-request input includes cache separately", () => {
  const claude = JSON.stringify({ type: "assistant", message: { role: "assistant", model: "opus", usage: { input_tokens: 3, cache_read_input_tokens: 12000, cache_creation_input_tokens: 500, output_tokens: 100 } } });
  expect(parseHarnessTotal("claude", claude, "s")?.used).toBe(12603);
  const omp = JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 100, output: 20, cacheRead: 1000, cacheWrite: 50, totalTokens: 9999999 } } });
  expect(parseHarnessTotal("omp", omp, "s")?.used).toBe(1170);
  expect(parseHarnessTotal("omp", 'invalid\n{"type":"header"}', "s")).toBeUndefined();
});
test("unsupported harnesses and unsafe session IDs never traverse the filesystem", () => {
  expect(harnessTotal("omp", "../../.env")).toBeUndefined();
  expect(harnessTotal("unknown", "01a15f23-b659-72a3-a6d9-61d9dabacff6")).toBeUndefined();
});

test("renamed OMP sessions resolve their UUID header instead of requiring the filename to match", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  const root = mkdtempSync(join(tmpdir(), "dash-omp-context-")); const before = process.env.PI_CODING_AGENT_DIR;
  try {
    const { mkdirSync } = await import("node:fs"); mkdirSync(join(root, "sessions"));
    const session = "01a15f23-b659-72a3-a6d9-61d9dabacff6";
    writeFileSync(join(root, "sessions", "Named session.jsonl"), [JSON.stringify({ type: "session", id: session }), JSON.stringify({ type: "message", message: { role: "assistant", model: "observed-model", provider: "observed-provider", usage: { input: 100, cacheRead: 1000, output: 20 } } })].join("\n"));
    process.env.PI_CODING_AGENT_DIR = root;
    expect(harnessTotal("omp", session)).toMatchObject({ used: 1120, model: "observed-model", provider: "observed-provider", maximum: 0 });
  } finally { if (before === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = before; rmSync(root, { recursive: true, force: true }); }
});
