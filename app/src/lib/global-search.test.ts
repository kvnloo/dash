import { describe, expect, test } from "bun:test";
import type { HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import {
  filterScopeSuggestions,
  parseSearchQuery,
  runGlobalSearch,
} from "./global-search";
import { liveConversationId } from "./live-sessions";

const now = 1_700_000_000_000;

const liveOmp: HostInfo = {
  id: "mbp",
  name: "mbp",
  hostname: "mbp",
  online: true,
  self: true,
  agents: [
    {
      id: "omp:aaa",
      name: "OMP",
      kind: "omp",
      status: "running",
      detail: "/home/you/workspace/dash",
      cwd: "/home/you/workspace/dash",
      sessionId: "01liveomp",
    },
    {
      id: "harness:codex",
      name: "Codex",
      kind: "codex",
      status: "available",
    },
    {
      id: "cursor-cloud",
      name: "Cursor",
      kind: "cursor-cloud",
      status: "running",
      sessionId: "cursor-secret",
    },
  ],
};

const groot: HostInfo = {
  id: "0",
  name: "0",
  hostname: "groot",
  online: true,
  self: false,
  agents: [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running", sessionId: "peer-sess" }],
};

const harnesses = [
  { id: "omp", name: "OMP", available: true },
  { id: "codex", name: "Codex", available: true },
];

describe("parseSearchQuery /live", () => {
  test("slash /live is scope live", () => {
    expect(parseSearchQuery("/live")).toEqual({ mode: "slash", scope: "live", rawScope: "live", text: "" });
  });

  test("unknown slash scopes fail closed", () => {
    expect(parseSearchQuery("/livez")).toEqual({
      mode: "slash",
      scope: "unknown",
      rawScope: "livez",
      text: "",
    });
    expect(runGlobalSearch({ query: "/livez", conversations: [], harnesses, hosts: [liveOmp] })).toEqual([]);
  });

  test("partial /li suggests /live", () => {
    expect(filterScopeSuggestions("/li")).toEqual([{ prefix: "/", label: "/live", scope: "live" }]);
  });
});

describe("runGlobalSearch /live", () => {
  test("returns live omp rows with sessionId from the paired self host", () => {
    const results = runGlobalSearch({
      query: "/live",
      conversations: [],
      harnesses,
      hosts: [liveOmp, groot],
    });
    expect(results).toHaveLength(1);
    const row = results[0];
    expect(row?.kind).toBe("conversation");
    if (row?.kind !== "conversation") throw new Error("expected conversation");
    expect(row.conversation.harness).toBe("omp");
    expect(row.conversation.sessionId).toBe("01liveomp");
    expect(row.conversation.id).toBe(liveConversationId("omp", "01liveomp"));
    expect(row.conversation.cwd).toBe("/home/you/workspace/dash");
  });

  test("does not invent Cursor-cloud or non-catalog harness rows", () => {
    const results = runGlobalSearch({
      query: "/live",
      conversations: [],
      harnesses,
      hosts: [liveOmp, groot],
    });
    expect(results.every((r) => r.kind === "conversation" && r.conversation.harness === "omp")).toBe(true);
    expect(results.some((r) => r.kind === "conversation" && r.conversation.sessionId === "cursor-secret")).toBe(
      false,
    );
    expect(results.some((r) => r.kind === "conversation" && r.conversation.sessionId === "peer-sess")).toBe(false);
  });

  test("an offline host does not advertise a live session", () => {
    expect(runGlobalSearch({ query: "/live", conversations: [], harnesses, hosts: [{ ...liveOmp, online: false }] })).toEqual([]);
  });

  test("selecting a live row reuses the store Conversation that already owns the session", () => {
    const existing: Conversation = {
      id: "phone-1",
      harness: "omp",
      title: "Ship chats",
      createdAt: now - 10,
      updatedAt: now - 10,
      sessionId: "01liveomp",
      cwd: "/home/you/workspace/dash",
      messages: [{ id: "m1", role: "user", text: "hi", at: now - 10 }],
    };
    const results = runGlobalSearch({
      query: "/live",
      conversations: [existing],
      harnesses,
      hosts: [liveOmp],
    });
    expect(results).toHaveLength(1);
    const row = results[0];
    if (row?.kind !== "conversation") throw new Error("expected conversation");
    expect(row.conversation.id).toBe("phone-1");
    expect(row.conversation.sessionId).toBe("01liveomp");
  });
});

describe("live slash evidence and activation safety", () => {
  test("only running paired-host sessions are listed, not parked or blank session IDs", () => {
    const host: HostInfo = {
      ...liveOmp,
      agents: [
        ...liveOmp.agents,
        { id: "omp:parked", name: "OMP parked", kind: "omp", status: "available", sessionId: "parked", cwd: "/work/parked" },
        { id: "omp:blank", name: "OMP blank", kind: "omp", status: "running", sessionId: "  " },
        { id: "codex:parked", name: "Codex parked", kind: "codex", status: "available", sessionId: "codex-id" },
      ],
    };
    const results = runGlobalSearch({ query: "/live", conversations: [], harnesses, hosts: [host, groot] });
    expect(results).toHaveLength(1);
    const row = results[0];
    if (row?.kind !== "conversation") throw new Error("expected one running catalog session");
    expect(row.conversation.sessionId).toBe("01liveomp");
    expect(row.conversation.targetHostId).toBe("mbp");
    expect(row.conversation.profileId).toBe("omp:aaa");
  });

  test("colliding synthetic live IDs fail closed instead of activating an arbitrary profile", () => {
    const running = liveOmp.agents.find((agent) => agent.id === "omp:aaa");
    if (!running) throw new Error("missing running fixture");
    const host: HostInfo = {
      ...liveOmp,
      agents: [
        { ...running, id: "omp:first", cwd: "/work/first" },
        { ...running, id: "omp:second", cwd: "/work/second" },
        { ...running, id: "omp:unique", sessionId: "different-session", cwd: "/work/different" },
      ],
    };
    const results = runGlobalSearch({ query: "/live", conversations: [], harnesses, hosts: [host] });
    expect(results).toHaveLength(1);
    const row = results[0];
    if (row?.kind !== "conversation") throw new Error("expected unambiguous live session");
    expect(row.conversation.sessionId).toBe("different-session");
    expect(row.conversation.profileId).toBe("omp:unique");
    expect(row.conversation.targetHostId).toBe("mbp");
  });

  test("live search selects a same-host chat rather than a remote chat sharing its session ID", () => {
    const remote: Conversation = {
      id: "remote-chat",
      harness: "omp",
      title: "remote workspace",
      createdAt: now,
      updatedAt: now,
      targetHostId: "another-host",
      profileId: "omp:aaa",
      sessionId: "01liveomp",
      messages: [],
    };
    const local: Conversation = {
      ...remote,
      id: "paired-chat",
      title: "paired workspace",
      targetHostId: "mbp",
      messages: [{ id: "u1", role: "user", text: "continue locally", at: now }],
    };
    const results = runGlobalSearch({
      query: "/live",
      conversations: [remote, local],
      harnesses,
      hosts: [liveOmp, groot],
    });
    expect(results).toHaveLength(1);
    const row = results[0];
    if (row?.kind !== "conversation") throw new Error("expected paired conversation");
    expect(row.conversation.id).toBe("paired-chat");
    expect(row.conversation.sessionId).toBe("01liveomp");
    expect(row.conversation.messages).toEqual(local.messages);
  });
});

describe("search uses bridge evidence", () => {
  test("an empty connection has no invented bots, projects, or resources", () => {
    for (const query of ["", "@bots", "@product", "/skill", "/plugin", "/tool", "/file"]) {
      expect(runGlobalSearch({ query, conversations: [], harnesses: [] })).toEqual([]);
    }
  });

  test("product search discovers a real directory outside the pinned catalog", () => {
    const host: HostInfo = {
      ...liveOmp,
      agents: [{ id: "codex:real", name: "Codex", kind: "codex", status: "running", cwd: "/work/weather-station", sessionId: "weather" }],
    };
    const results = runGlobalSearch({ query: "@product weather", conversations: [], harnesses, hosts: [host] });
    expect(results).toHaveLength(1);
    const row = results[0];
    if (row?.kind !== "product") throw new Error("expected product");
    expect(row.project.name).toBe("weather-station");
    expect(row.project.agents).toEqual(["codex"]);
    expect(row.project.subtitle).toContain("/work/weather-station");
  });

  test("bot search lists only deployed bots the host reports, never harnesses", () => {
    expect(runGlobalSearch({ query: "@bots", conversations: [], harnesses, hosts: [groot] })).toEqual([]);
    const withBot: HostInfo = { ...groot, bots: [{ id: "hermes-bot:clean", name: "clean", runtime: "hermes", status: "running", channels: [{ platform: "telegram", state: "connected" }], agentId: "hermes:clean" }] };
    const results = runGlobalSearch({ query: "@bots tele", conversations: [], harnesses, hosts: [withBot] });
    expect(results).toHaveLength(1);
    const row = results[0];
    if (row?.kind !== "bot") throw new Error("expected bot");
    expect(row.bot.name).toBe("clean");
    expect(row.subtitle).toBe(`${groot.name} · Telegram connected`);
    expect(row.target).toBeUndefined();
  });
});
