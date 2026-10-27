// DASH_PERF=1 bun test --timeout 120000 bridge/src/chat-index/perf.test.ts
// 20k sessions / 400k messages, real Bun Workers, 50 iterations after one warm-up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { AgentsviewFixture, tempDir } from "../fixtures/chat-index/make-fixtures";
import { ChatIndexClient } from "./client";
import { filterHash, queryHash } from "./query";

const RUN = process.env.DASH_PERF === "1";
const SESSIONS = Number(process.env.DASH_PERF_SESSIONS ?? "20000");
const PER_SESSION = Number(process.env.DASH_PERF_MESSAGES ?? "20");
const SELF = { id: "0", name: "perf" };
const WORDS = "bridge router flamingo deploy schema index worker chat search page cursor history roster phone lazy render token build cache query merge".split(" ");

let dir = "";
let avPath = "";
let client: ChatIndexClient | undefined;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

async function measure(label: string, fn: (i: number) => Promise<unknown>): Promise<number> {
  await fn(-1);
  const samples: number[] = [];
  for (let i = 0; i < 50; i++) { const t = performance.now(); await fn(i); samples.push(performance.now() - t); }
  const value = p95(samples);
  process.stderr.write(`perf ${label}: p50=${samples.sort((a, b) => a - b)[25]?.toFixed(1)}ms p95=${value.toFixed(1)}ms\n`);
  return value;
}

describe.skipIf(!RUN)("chat index at 20k sessions / 400k messages", () => {
  beforeAll(() => {
    dir = tempDir("dash-chat-perf-");
    const av = new AgentsviewFixture(join(dir, "av.db"));
    avPath = av.path;
    const started = performance.now();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const word = () => WORDS[Math.floor(rnd() * WORDS.length)] ?? "chat";
    av.db.transaction(() => {
      for (let s = 0; s < SESSIONS; s++) {
        const agent = ["omp", "codex", "claude", "grok", "opencode"][s % 5] ?? "codex";
        const at = Date.UTC(2025, 0, 1) + s * 60_000;
        av.session({ id: `${agent}:p${s}`, agent, machine: s % 7 === 0 ? "b163c2db159f66e6567dc1fe9acb4706" : "local", first_message: `${word()} ${word()} ${word()} task ${s}`, cwd: `/w/${word()}/${s % 50}`, ended_at: new Date(at).toISOString(), started_at: new Date(at - 30_000).toISOString(), message_count: PER_SESSION });
        for (let m = 0; m < PER_SESSION; m++) av.message({ session_id: `${agent}:p${s}`, ordinal: m, role: m % 2 ? "assistant" : "user", content: `${word()} ${word()} ${word()} ${word()} ${word()} ${word()} note ${s}-${m}${m === 7 && s % 997 === 0 ? " zanzibar" : ""}`, timestamp: new Date(at - 30_000 + m * 1000).toISOString() });
      }
    })();
    av.close();
    process.stderr.write(`perf fixture: ${SESSIONS} sessions, ${SESSIONS * PER_SESSION} messages in ${((performance.now() - started) / 1000).toFixed(1)}s\n`);
  }, 600_000);

  afterAll(() => client?.stop());

  test("full re-ingest runs off the main thread: event-loop lag stays < 50 ms", async () => {
    client = new ChatIndexClient({ config: { sidecarPath: join(dir, "sidecar.db"), agentsviewPath: avPath, hermesRoot: join(dir, "no-hermes"), archiveHead: 10, selfMachines: ["local"] } });
    let maxLag = 0;
    let last = performance.now();
    const timer = setInterval(() => { const now = performance.now(); maxLag = Math.max(maxLag, now - last - 10); last = now; }, 10);
    const started = performance.now();
    for (let n = 0; n < 6000 && client.building; n++) await Bun.sleep(10);
    // The boot reconcile walk follows the incremental build; keep sampling through it.
    await Bun.sleep(1500);
    clearInterval(timer);
    process.stderr.write(`perf ingest: built in ${((performance.now() - started) / 1000).toFixed(1)}s, max event-loop lag ${maxLag.toFixed(1)}ms\n`);
    expect(client.building).toBe(false);
    expect(maxLag).toBeLessThan(50);
  }, 600_000);

  test("p95 < 150 ms: list page, title search, message search page, history page", async () => {
    const c = client;
    if (!c) throw new Error("client not started");
    const filters = { kinds: [], hosts: [], chatable: false };
    const fh = filterHash(filters);
    let cursor: string | undefined;
    const list = await measure("list(50)", async () => {
      const page = await c.list({ limit: 50, ...(cursor ? { cursor } : {}), fh, ...filters, self: SELF });
      cursor = page.next ?? undefined;
    });
    const title = await measure("title search", i => c.titleSearch({ q: `${WORDS[(i + 20) % WORDS.length]} task`, qh: queryHash("x", filters, "all"), limit: 20, kinds: [], hosts: [], self: SELF }));
    const msg = await measure("message search(20)", i => c.msgSearch({ q: i % 2 ? "zanzibar" : `${WORDS[(i + 20) % WORDS.length]} note`, limit: 20, positions: "start", exclude: [], kinds: [], hosts: [], self: SELF }));
    const history = await measure("history(50)", i => c.history({ key: `@self:codex:p${(Math.abs(i) * 37 * 5 + 1) % SESSIONS}`, limit: 50, self: SELF }).catch(() => c.history({ key: "@self:codex:p1", limit: 50, self: SELF })));
    expect(list).toBeLessThan(150);
    expect(title).toBeLessThan(150);
    expect(msg).toBeLessThan(150);
    expect(history).toBeLessThan(150);
  }, 600_000);
});
