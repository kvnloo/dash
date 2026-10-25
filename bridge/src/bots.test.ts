import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { botStatus, channelState, enabledPlatforms, grokDesktopBot, hermesBots, parseGatewayState, profileChannels, serviceBots, type GatewayState, type HermesBotSources } from "./bots";

describe("enabledPlatforms", () => {
  test("reads both config layouts and only messaging platforms that are on", () => {
    expect(enabledPlatforms({ platforms: { telegram: { enabled: true }, discord: { enabled: false } } })).toEqual(["telegram"]);
    expect(enabledPlatforms({ gateway: { platforms: { a2a: { enabled: true }, discord: { enabled: true }, telegram: { enabled: true } } } })).toEqual(["discord", "telegram"]);
    expect(enabledPlatforms({ platforms: { api_server: { enabled: true }, webhook: { enabled: true } } })).toEqual([]);
    expect(enabledPlatforms({ platforms: { telegram: { enabled: "yes" } } })).toEqual([]);
    expect(enabledPlatforms({ discord: { require_mention: true } })).toEqual([]);
    expect(enabledPlatforms(null)).toEqual([]);
    expect(enabledPlatforms([])).toEqual([]);
  });
});

describe("gateway state", () => {
  const raw = { pid: 7, hermes_home: "/h", gateway_state: "running", platforms: { telegram: { state: "connected" }, "clean:telegram": { state: "retrying" }, bad: 1 } };
  test("parses platform states and liveness", () => {
    expect(parseGatewayState(raw, () => true)).toEqual({ home: "/h", alive: true, platforms: { telegram: "connected", "clean:telegram": "retrying" } });
    expect(parseGatewayState(raw, () => false)?.alive).toBe(false);
    expect(parseGatewayState({ ...raw, gateway_state: "stopped" }, () => true)?.alive).toBe(false);
    expect(parseGatewayState({ ...raw, gateway_state: "starting" }, () => true)?.alive).toBe(true);
    expect(parseGatewayState({ ...raw, platforms: undefined }, () => true)?.platforms).toEqual({});
    expect(parseGatewayState({ pid: "7", hermes_home: "/h" }, () => true)).toBeNull();
    expect(parseGatewayState(null, () => true)).toBeNull();
  });
  test("maps link states", () => {
    expect(channelState("connected")).toBe("connected");
    for (const s of ["retrying", "connecting", "reconnecting", "starting"]) expect(channelState(s)).toBe("retrying");
    for (const s of ["disconnected", "failed", "stopped", ""]) expect(channelState(s)).toBe("disconnected");
    expect(botStatus([{ platform: "telegram", state: "connected" }, { platform: "discord", state: "configured" }])).toBe("running");
    expect(botStatus([{ platform: "telegram", state: "retrying" }])).toBe("available");
    expect(botStatus([])).toBe("available");
  });
});

describe("profileChannels", () => {
  const same = (a: string, b: string) => a === b;
  const states: GatewayState[] = [
    { home: "/h", alive: true, platforms: { telegram: "connected", feishu: "retrying", api_server: "connected", "clean:telegram": "connected", "clean:discord": "disconnected" } },
    { home: "/h/profiles/intake", alive: false, platforms: { telegram: "connected" } },
  ];
  test("own plain keys belong to the gateway's home profile", () => {
    expect(profileChannels({ id: "default", home: "/h" }, ["telegram"], states, same)).toEqual([{ platform: "feishu", state: "retrying" }, { platform: "telegram", state: "connected" }]);
  });
  test("prefixed keys come from a multiplexing gateway", () => {
    expect(profileChannels({ id: "clean", home: "/h/profiles/clean" }, ["telegram"], states, same)).toEqual([{ platform: "discord", state: "disconnected" }, { platform: "telegram", state: "connected" }]);
  });
  test("a dead gateway reports nothing; config alone is configured", () => {
    expect(profileChannels({ id: "intake", home: "/h/profiles/intake" }, ["telegram"], states, same)).toEqual([{ platform: "telegram", state: "configured" }]);
    expect(profileChannels({ id: "loo", home: "/h/profiles/loo" }, [], states, same)).toEqual([]);
  });
  test("keeps the best report when two gateways disagree", () => {
    const two: GatewayState[] = [{ home: "/a", alive: true, platforms: { "p:telegram": "retrying" } }, { home: "/b", alive: true, platforms: { "p:telegram": "connected" } }, { home: "/c", alive: true, platforms: { "p:telegram": "disconnected" } }];
    expect(profileChannels({ id: "p", home: "/p" }, [], two, same)).toEqual([{ platform: "telegram", state: "connected" }]);
  });
});

describe("hermesBots", () => {
  function sources(files: Record<string, string>, dirs: string[]): HermesBotSources {
    return {
      root: "/h",
      read: path => files[path] ?? null,
      list: dir => (dir === join("/h", "profiles") ? dirs : []),
      parseYaml: text => JSON.parse(text),
      alive: pid => pid === 1,
      same: (a, b) => a === b,
    };
  }
  test("lists profiles with messaging channels and skips the rest", () => {
    const bots = hermesBots(sources({
      "/h/config.yaml": JSON.stringify({ gateway: { platforms: { telegram: { enabled: true } } } }),
      "/h/gateway_state.json": JSON.stringify({ pid: 1, hermes_home: "/h", gateway_state: "running", platforms: { telegram: { state: "connected" }, "clean:telegram": { state: "connected" } } }),
      "/h/profiles/clean/config.yaml": JSON.stringify({ platforms: { telegram: { enabled: true } } }),
      "/h/profiles/intake/config.yaml": JSON.stringify({ platforms: { telegram: { enabled: true } } }),
      "/h/profiles/intake/gateway_state.json": "{torn",
      "/h/profiles/lab/config.yaml": JSON.stringify({ platforms: { telegram: { enabled: false } } }),
      "/h/profiles/broken/config.yaml": "{",
    }, ["broken", "clean", "intake", "lab", "../x"]));
    expect(bots.map(b => [b.name, b.status, b.channels.map(c => `${c.platform}:${c.state}`).join(",")])).toEqual([
      ["default", "running", "telegram:connected"],
      ["clean", "running", "telegram:connected"],
      ["intake", "available", "telegram:configured"],
    ]);
    expect(bots[1]).toMatchObject({ id: "hermes-bot:clean", runtime: "hermes", agentId: "hermes:clean" });
  });
  test("a profile directory that resolves to the root is listed once", () => {
    const src = sources({ "/h/config.yaml": JSON.stringify({ platforms: { slack: { enabled: true } } }) }, ["default"]);
    src.same = (a, b) => a.replace(/\/profiles\/default$/, "") === b.replace(/\/profiles\/default$/, "");
    expect(hermesBots(src)).toHaveLength(1);
  });
});

describe("service and desktop bots", () => {
  test("recognises bot/dots unit names but not other services or Hermes plumbing", () => {
    const listing = [
      "opendots.service loaded active running OpenDots",
      "grokbot.service loaded active running GrokBot",
      "family-bot.service loaded active running x",
      "hermes-gateway.service loaded active running y",
      "robotics-sim.service loaded active running z",
      "tailscaled.service loaded active running",
      "not-a-unit",
    ].join("\n");
    expect(serviceBots(listing).map(b => b.name)).toEqual(["opendots", "grokbot", "family-bot"]);
    expect(serviceBots(listing)[0]).toMatchObject({ id: "service:opendots", runtime: "service", status: "running", channels: [] });
    expect(serviceBots("")).toEqual([]);
  });
  test("GrokBot desktop", () => {
    expect(grokDesktopBot()).toMatchObject({ id: "grok-bot", name: "GrokBot", runtime: "grok", agentId: "grok-bot" });
  });
});
