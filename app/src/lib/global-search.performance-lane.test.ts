import { describe, expect, test } from "bun:test";
import type { BotInfo, HostInfo } from "../../../shared/protocol";
import type { OrchestraProject } from "../catalog/orchestra";
import type { Conversation } from "../model";
import { parseSearchQuery, runGlobalSearch, type SearchResult } from "./global-search";

/**
 * Deterministic performance guards, not wall-clock benchmarks.
 *
 * Optional local timing recipe (NOT RUN):
 * From the repository root, on the same machine and Bun version for both
 * the integration-base SHA and this PR head, run:
 *   for i in 1 2 3 4 5; do time bun test app/src/lib/global-search.performance-lane.test.ts; done
 * The empty-discovery fixture has 1,024 conversations, 768 bots, 512
 * products, and 32 harnesses. The scoped-search fixture adds one target
 * to each catalog and one extra harness. Compare runs on identical inputs;
 * shell timing includes Bun startup and is not app search latency.
 * Wall time: NOT RUN. CPU time: NOT RUN. Memory: NOT RUN. Device: NOT RUN.
 */

const EPOCH = 1_700_000_000_000;
const HARNESSES = [
  { id: "omp", name: "OMP", available: true },
  ...Array.from({ length: 31 }, (_, n) => ({
    id: `h-${n}`,
    name: `Harness ${n}`,
    available: n % 2 === 0,
  })),
];

function conversation(n: number): Conversation {
  return {
    id: `chat-${n}`,
    harness: "omp",
    title: `Work ${n}`,
    createdAt: EPOCH,
    updatedAt: EPOCH + n,
    messages: [{ id: `message-${n}`, role: "user", text: `Body ${n}`, at: EPOCH + n }],
  };
}

function bot(n: number): BotInfo {
  return {
    id: `bot-${n}`,
    name: `Bot ${n}`,
    runtime: "hermes",
    status: n % 2 === 0 ? "running" : "available",
    channels: [],
  };
}

function product(n: number): OrchestraProject {
  return {
    id: `project-${n}`,
    name: `Project ${n}`,
    subtitle: `Source ${n}`,
    agents: ["omp"],
    chatIds: [],
    status: "active",
    updatedAt: EPOCH + n,
    topologyId: "solo",
    providerId: "unknown",
  };
}

function host(bots: BotInfo[]): HostInfo {
  return { id: "host-a", name: "Bench", hostname: "bench", online: true, self: false, agents: [], bots };
}

describe("parseSearchQuery performance-lane boundaries", () => {
  test("keeps normalized scope, alias, and complete target text", () => {
    expect(parseSearchQuery("   @ConVerastion   NeEdLe work  ")).toEqual({
      mode: "mention", scope: "conversation", rawScope: "converastion", text: "needle work",
    });
    expect(parseSearchQuery("  /HARNESSes   NeEdLe  ")).toEqual({
      mode: "slash", scope: "harness", rawScope: "harnesses", text: "needle",
    });
    expect(parseSearchQuery("  Bare   NeEdLe  ")).toEqual({
      mode: "discover", text: "bare   needle",
    });
    expect(parseSearchQuery("@unlisted NeEdLe")).toEqual({
      mode: "mention", scope: "unknown", rawScope: "unlisted", text: "needle",
    });
    expect(parseSearchQuery("/unlisted NeEdLe")).toEqual({
      mode: "slash", scope: "unknown", rawScope: "unlisted", text: "needle",
    });
  });

  test("repeat parsing leaves inputs and outputs unchanged", () => {
    const queries = [
      " @bots  Alpha  ", "@products   Beta", "@chats   Gamma",
      "/harness  Delta", "/not-a-scope", "  Epsilon  ",
    ];
    const expected = queries.map(parseSearchQuery);
    for (let i = 0; i < 10; i += 1) {
      expect(queries.map(parseSearchQuery)).toEqual(expected);
    }
    expect(queries).toEqual([
      " @bots  Alpha  ", "@products   Beta", "@chats   Gamma",
      "/harness  Delta", "/not-a-scope", "  Epsilon  ",
    ]);
  });
});

describe("runGlobalSearch source-defined operation bounds", () => {
  test("empty discovery caps 8 recent chats, 6 running-first bots, 4 recent projects, without mutating large frozen catalogs", () => {
    const chats = Array.from({ length: 1_024 }, (_, n) => conversation(n));
    const bots = Array.from({ length: 768 }, (_, n) => bot(n));
    const products = Array.from({ length: 512 }, (_, n) => product(n));
    const hosts = [host(bots)];

    for (const chat of chats) {
      Object.freeze(chat.messages);
      Object.freeze(chat);
    }
    for (const item of bots) {
      Object.freeze(item.channels);
      Object.freeze(item);
    }
    for (const item of products) {
      Object.freeze(item.agents);
      Object.freeze(item);
    }
    Object.freeze(chats);
    Object.freeze(bots);
    Object.freeze(products);
    Object.freeze(hosts[0]);
    Object.freeze(hosts);
    Object.freeze(HARNESSES);

    const params = { query: "   ", conversations: chats, harnesses: HARNESSES, products, hosts };
    const first = runGlobalSearch(params);
    const expectedKeys = [
      ...Array.from({ length: 8 }, (_, n) => `conv:chat-${1_023 - n}`),
      ...Array.from({ length: 6 }, (_, n) => `bot:host-a:bot-${2 * n}`),
      ...Array.from({ length: 4 }, (_, n) => `prod:project-${511 - n}`),
    ];
    expect(first.map((row) => row.key)).toEqual(expectedKeys);
    expect(first).toHaveLength(18);
    expect(first[0]?.kind).toBe("conversation");
    expect(first[8]?.kind).toBe("bot");
    expect(first[14]?.kind).toBe("product");
    expect(runGlobalSearch(params)).toEqual(first);
    expect(chats.map((row) => row.id)).toEqual(Array.from({ length: 1_024 }, (_, n) => `chat-${n}`));
    expect(bots.map((row) => row.id)).toEqual(Array.from({ length: 768 }, (_, n) => `bot-${n}`));
    expect(products.map((row) => row.id)).toEqual(Array.from({ length: 512 }, (_, n) => `project-${n}`));
  });

  test("small and large catalogs return identical exact target rows across scopes", () => {
    const targetChat: Conversation = {
      ...conversation(2_048),
      title: "Needle Chat",
      updatedAt: EPOCH - 1,
      messages: [{ id: "needle-message", role: "user", text: "Needle payload", at: EPOCH }],
    };
    const targetBot: BotInfo = {
      ...bot(2_048), name: "Needle bot", status: "available",
      channels: [{ platform: "telegram", state: "connected" }],
    };
    const targetProject: OrchestraProject = {
      ...product(2_048), name: "Needle Project", updatedAt: EPOCH - 1,
    };
    const harnesses = [
      ...HARNESSES,
      { id: "needle-harness", name: "Needle Harness", available: false },
    ];
    const small = {
      conversations: [targetChat], hosts: [host([targetBot])],
      products: [targetProject], harnesses,
    };
    const large = {
      conversations: [...Array.from({ length: 1_024 }, (_, n) => conversation(n)), targetChat],
      hosts: [host([...Array.from({ length: 768 }, (_, n) => bot(n)), targetBot])],
      products: [...Array.from({ length: 512 }, (_, n) => product(n)), targetProject],
      harnesses,
    };
    const expectedBot: SearchResult = {
      kind: "bot", key: "bot:host-a:bot-2048", bot: targetBot,
      hostName: "Bench", target: undefined, subtitle: "Bench · Telegram connected",
    };
    const expectedChat: SearchResult = {
      kind: "conversation", key: "conv:chat-2048", conversation: targetChat,
      harnessName: "OMP", subtitle: "Needle payload",
    };
    const expectedProject: SearchResult = {
      kind: "product", key: "prod:project-2048", project: targetProject,
      subtitle: "Source 2048",
    };
    const expectedHarness: SearchResult = {
      kind: "harness", key: "harness:needle-harness",
      id: "needle-harness", name: "Needle Harness",
      available: false, subtitle: "Not installed on laptop",
    };

    const cases: { query: string; expected: SearchResult[] }[] = [
      { query: "  NeEdLe  ", expected: [expectedBot, expectedChat, expectedProject] },
      { query: "@bots needle", expected: [expectedBot] },
      { query: "@conversations needle", expected: [expectedChat] },
      { query: "@product needle", expected: [expectedProject] },
      { query: "/harnesses needle", expected: [expectedHarness] },
      { query: "@unlisted needle", expected: [] },
      { query: "/unlisted needle", expected: [] },
    ];
    for (const entry of cases) {
      expect(runGlobalSearch({ ...small, query: entry.query })).toEqual(entry.expected);
      expect(runGlobalSearch({ ...large, query: entry.query })).toEqual(entry.expected);
    }
    const discovered = runGlobalSearch({ ...large, query: "needle" });
    expect(discovered[0]?.kind === "bot" && discovered[0].bot).toBe(targetBot);
    expect(discovered[1]?.kind === "conversation" && discovered[1].conversation).toBe(targetChat);
    expect(discovered[2]?.kind === "product" && discovered[2].project).toBe(targetProject);
  });

  test("nonempty matching discovery and scoped queries do not inherit empty-discovery caps", () => {
    const chats = Array.from({ length: 24 }, (_, n) => ({ ...conversation(n), title: `needle chat ${n}` }));
    const bots = Array.from({ length: 20 }, (_, n) => ({ ...bot(n), name: `needle bot ${n}` }));
    const products = Array.from({ length: 12 }, (_, n) => ({ ...product(n), name: `needle project ${n}` }));
    const input = { conversations: chats, hosts: [host(bots)], products, harnesses: HARNESSES };
    const botKeys = [
      ...bots.filter((item) => item.status === "running"),
      ...bots.filter((item) => item.status !== "running"),
    ].map((item) => `bot:host-a:${item.id}`);
    const chatKeys = [...chats].reverse().map((item) => `conv:${item.id}`);
    const projectKeys = [...products].reverse().map((item) => `prod:${item.id}`);

    expect(runGlobalSearch({ ...input, query: "needle" }).map((row) => row.key)).toEqual([
      ...botKeys, ...chatKeys, ...projectKeys,
    ]);
    expect(runGlobalSearch({ ...input, query: "@bots needle" }).map((row) => row.key)).toEqual(botKeys);
    expect(runGlobalSearch({ ...input, query: "@chat needle" }).map((row) => row.key)).toEqual(chatKeys);
    expect(runGlobalSearch({ ...input, query: "@orchestra needle" }).map((row) => row.key)).toEqual(projectKeys);
  });

  test("only visited previews and summaries are evaluated; unrelated scopes skip them", () => {
    let chatPreviewReads = 0;
    let botChannelReads = 0;
    let productAgentReads = 0;

    const chats: Conversation[] = Array.from({ length: 48 }, (_, n) => {
      const source = conversation(n);
      return { ...source, get messages() { chatPreviewReads += 1; return source.messages; } };
    });
    const bots: BotInfo[] = Array.from({ length: 48 }, (_, n) => {
      const source = bot(n);
      return { ...source, get channels() { botChannelReads += 1; return source.channels; } };
    });
    const products: OrchestraProject[] = Array.from({ length: 48 }, (_, n) => {
      const source = product(n);
      return { ...source, get agents() { productAgentReads += 1; return source.agents; } };
    });
    const input = { conversations: chats, hosts: [host(bots)], products, harnesses: HARNESSES };
    expect(runGlobalSearch({ ...input, query: "" })).toHaveLength(18);
    expect(chatPreviewReads).toBe(8);
    expect(botChannelReads).toBe(6);
    expect(productAgentReads).toBe(4);

    chatPreviewReads = 0;
    botChannelReads = 0;
    productAgentReads = 0;
    expect(runGlobalSearch({ ...input, query: "@bots no-match" })).toEqual([]);
    expect(chatPreviewReads).toBe(0);
    expect(botChannelReads).toBe(48);
    expect(productAgentReads).toBe(0);

    chatPreviewReads = 0;
    botChannelReads = 0;
    productAgentReads = 0;
    expect(runGlobalSearch({ ...input, query: "/harness h-0" })).toHaveLength(1);
    expect(runGlobalSearch({ ...input, query: "@unlisted no-match" })).toEqual([]);
    expect(chatPreviewReads).toBe(0);
    expect(botChannelReads).toBe(0);
    expect(productAgentReads).toBe(0);
  });

  test("pure local searches neither fetch nor create global timers, and restore guards", () => {
    // Bun's fetch and setTimeout have callable static members, so a plain
    // spy implementation is not assignable to their complete global types.
    // Replace the values under their existing descriptors and restore those
    // exact descriptors even if an assertion or a forbidden call throws.
    const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    const originalTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
    const originalInterval = Object.getOwnPropertyDescriptor(globalThis, "setInterval");
    if (!originalFetch || !originalTimeout || !originalInterval) {
      throw new Error("global search guards require own global descriptors");
    }
    let fetchCalls = 0;
    let timeoutCalls = 0;
    let intervalCalls = 0;
    function forbidFetch(..._args: Parameters<typeof globalThis.fetch>): ReturnType<typeof globalThis.fetch> {
      fetchCalls += 1;
      throw new Error("global search must not fetch");
    }
    function forbidTimeout(..._args: Parameters<typeof globalThis.setTimeout>): ReturnType<typeof globalThis.setTimeout> {
      timeoutCalls += 1;
      throw new Error("global search must not schedule a timeout");
    }
    function forbidInterval(..._args: Parameters<typeof globalThis.setInterval>): ReturnType<typeof globalThis.setInterval> {
      intervalCalls += 1;
      throw new Error("global search must not schedule an interval");
    }
    try {
      Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: forbidFetch });
      Object.defineProperty(globalThis, "setTimeout", { configurable: true, writable: true, value: forbidTimeout });
      Object.defineProperty(globalThis, "setInterval", { configurable: true, writable: true, value: forbidInterval });
      const chats = [conversation(1)];
      const bots = [bot(1)];
      const products = [product(1)];
      const input = { conversations: chats, hosts: [host(bots)], products, harnesses: HARNESSES };
      expect(runGlobalSearch({ ...input, query: "" })).toHaveLength(3);
      expect(runGlobalSearch({ ...input, query: "@bots bot" }).map((row) => row.key))
        .toEqual(["bot:host-a:bot-1"]);
      expect(parseSearchQuery(" /harness omp ")).toEqual({
        mode: "slash", scope: "harness", rawScope: "harness", text: "omp",
      });
      expect(fetchCalls).toBe(0);
      expect(timeoutCalls).toBe(0);
      expect(intervalCalls).toBe(0);
    } finally {
      Object.defineProperty(globalThis, "setInterval", originalInterval);
      Object.defineProperty(globalThis, "setTimeout", originalTimeout);
      Object.defineProperty(globalThis, "fetch", originalFetch);
    }
  });
});
