import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("MainScreen /live attach", () => {
  test("selecting a live conversation navigates to Chat with that session active", () => {
    const main = readFileSync(join(import.meta.dir, "../screens/MainScreen.tsx"), "utf8");
    expect(main).toContain("hosts");
    expect(main).toContain("runGlobalSearch({ query, conversations, harnesses, botProfiles, hosts })");
    expect(main).toContain('case "conversation":');
    expect(main).toContain("openConversation(item.conversation.id)");
    expect(main).toContain("setActive(id)");
    expect(main).toContain('navigation.navigate("Chat")');
  });
});
