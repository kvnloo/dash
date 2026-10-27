import { describe, expect, test } from "bun:test";
import type { BotInfo, HostInfo } from "../../../shared/protocol";
import { botSummary, botTarget, botsRows, hostCountLabel, parseCollapsed, platformName, toggleCollapsed } from "./bots";

const clean: BotInfo = { id: "hermes-bot:clean", name: "clean", runtime: "hermes", status: "running", channels: [{ platform: "telegram", state: "connected" }], agentId: "hermes:clean" };
const chief: BotInfo = { id: "hermes-bot:chiefstaff", name: "chiefstaff", runtime: "hermes", status: "available", channels: [{ platform: "discord", state: "configured" }, { platform: "telegram", state: "configured" }], agentId: "hermes:chiefstaff" };
const groot: HostInfo = { id: "groot", name: "groot", hostname: "groot", online: true, self: true, address: "100.1.1.1", agents: [{ id: "hermes:clean", name: "clean", kind: "hermes", status: "running" }, { id: "harness:codex", name: "Codex", kind: "codex", status: "available" }], bots: [clean, chief] };
const mbp: HostInfo = { id: "mbp", name: "mbp", hostname: "mbp", online: true, self: false, agents: [] };
const pi: HostInfo = { id: "pi", name: "pi", hostname: "pi", online: false, self: false, agents: [], bots: [] };

describe("botSummary", () => {
  test("groups channels by link state in a fixed order", () => {
    expect(botSummary(clean)).toBe("Telegram connected");
    expect(botSummary(chief)).toBe("Discord, Telegram not running");
    expect(botSummary({ ...clean, channels: [{ platform: "feishu", state: "retrying" }, { platform: "telegram", state: "configured" }, { platform: "x", state: "disconnected" }, { platform: "slack", state: "connected" }] }))
      .toBe("Slack connected · Feishu reconnecting · X disconnected · Telegram not running");
  });
  test("services without channels describe themselves", () => {
    expect(botSummary({ ...clean, channels: [], detail: "User service" })).toBe("User service");
    expect(botSummary({ ...clean, channels: [], detail: undefined })).toBe("Running");
    expect(botSummary({ ...clean, channels: [], detail: undefined, status: "available" })).toBe("Not running");
  });
  test("platform names", () => {
    expect(platformName("whatsapp")).toBe("WhatsApp");
    expect(platformName("qqbot")).toBe("QQ");
    expect(platformName("zulip")).toBe("Zulip");
  });
});

describe("botsRows", () => {
  test("lists only bots under each host, never harnesses or sessions", () => {
    const rows = botsRows([groot], new Set());
    expect(rows.map(r => r.kind)).toEqual(["host", "bot", "bot"]);
    expect(rows.filter(r => r.kind === "bot").map(r => (r.kind === "bot" ? r.bot.name : ""))).toEqual(["clean", "chiefstaff"]);
    expect(rows[0]).toMatchObject({ kind: "host", count: 2, collapsed: false });
  });
  test("collapsed hosts keep only their header with the count", () => {
    const rows = botsRows([groot, mbp], new Set(["groot"]));
    expect(rows.map(r => r.id)).toEqual(["host:groot", "host:mbp", "note:mbp"]);
    expect(rows[0]).toMatchObject({ collapsed: true, count: 2 });
  });
  test("explains hosts that report no bots or an old bridge", () => {
    const rows = botsRows([mbp, pi, { ...mbp, id: "old", online: false }], new Set());
    expect(rows.flatMap(r => (r.kind === "note" ? [r.text] : []))).toEqual(["This host's bridge does not report bots yet.", "No bots deployed here.", "Offline"]);
    expect(rows[0]).toMatchObject({ count: null });
  });
  test("count labels", () => {
    expect(hostCountLabel(null)).toBe("");
    expect(hostCountLabel(0)).toBe("0 bots");
    expect(hostCountLabel(1)).toBe("1 bot");
    expect(hostCountLabel(3)).toBe("3 bots");
  });
});

describe("collapsed state", () => {
  test("toggles without mutating", () => {
    const a = new Set(["x"]);
    const b = toggleCollapsed(a, "y");
    expect([...b].sort()).toEqual(["x", "y"]);
    expect([...a]).toEqual(["x"]);
    expect([...toggleCollapsed(b, "x")]).toEqual(["y"]);
  });
  test("parses persisted ids and fails open to expanded", () => {
    expect([...parseCollapsed(JSON.stringify(["groot", 3, "", "mbp"]))]).toEqual(["groot", "mbp"]);
    expect([...parseCollapsed(JSON.stringify(["x".repeat(201)]))]).toEqual([]);
    expect(parseCollapsed(null).size).toBe(0);
    expect(parseCollapsed("{").size).toBe(0);
    expect(parseCollapsed("{}").size).toBe(0);
  });
});

describe("botTarget", () => {
  test("opens the agent behind a bot only when the host lists it", () => {
    expect(botTarget(groot, clean)).toMatchObject({ profileId: "hermes:clean", targetHostId: "groot", harness: "hermes" });
    expect(botTarget(groot, chief)).toBeUndefined();
    expect(botTarget(groot, { ...clean, agentId: undefined })).toBeUndefined();
  });
});
