import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRole, parseRoles } from "../../shared/model-roles";
import { loadRoles, resolveRoles } from "./model-roles";
import { createModelsHttpHandler } from "./models-http";

describe("model roles", () => {
  test("OMP names, aliases and additional current OMP roles", () => {
    expect(canonicalRole("large")).toBe("slow"); expect(canonicalRole("@planning")).toBe("plan");
    expect(canonicalRole("orchestrating")).toBe("orchestrator"); expect(canonicalRole("bogus")).toBeUndefined();
    expect(resolveRoles().map(row => row.role)).toEqual(["tiny", "smol", "default", "slow", "vision", "plan", "task", "advisor", "judge", "orchestrator", "commit", "memory", "widget", "image", "web", "speech", "dictation"]);
  });
  test("field-wise precedence and fallback expansion", () => {
    const roles = resolveRoles({ modelRoles: { smol: "anthropic/haiku", default: "openai/sol", judge: "typesafe/jev" }, retry: { fallbackChains: { judge: ["@default"], smol: ["openai/luna"] } } }, { modelRoles: { large: "local/large", smol: "local/small" } });
    expect(roles.find(row => row.role === "smol")).toMatchObject({ model: "local/small", source: "dash", fallback: ["openai/luna"], health: "unknown" });
    expect(roles.find(row => row.role === "slow")?.model).toBe("local/large");
    expect(roles.find(row => row.role === "judge")).toMatchObject({ source: "omp", fallback: ["openai/sol"] });
    expect(roles.find(row => row.role === "orchestrator")?.model).toBe("openai/sol");
    expect(roles.find(row => row.role === "tiny")?.fallback).toEqual(["typesafe/jev-latest", "local/small", "openai/luna"]);
    expect(parseRoles(roles)).toEqual(roles);
  });
  test("cycles fail closed; fallback cycles terminate", () => {
    expect(() => resolveRoles({ modelRoles: { default: "@smol", smol: "@default" } })).toThrow("cycle");
    expect(() => resolveRoles({ modelRoles: { smol: "@missing" } })).toThrow("Unknown");
    expect(resolveRoles({ retry: { fallbackChains: { smol: ["@smol"] } } }).find(row => row.role === "smol")?.fallback).toEqual([]);
  });
  test("missing files, YAML overrides, invalid file redaction", () => {
    const dir = mkdtempSync(join(tmpdir(), "dash-roles-"));
    try {
      const ompFile = join(dir, "omp.yml");
      expect(loadRoles({ ompFile, configDir: dir })[0]?.source).toBe("default");
      writeFileSync(ompFile, "modelRoles:\n  smol: local/test\n");
      expect(loadRoles({ ompFile, configDir: dir }).find(row => row.role === "smol")?.source).toBe("omp");
      writeFileSync(join(dir, "model-roles.yml"), "modelRoles:\n  smol: local/override\nretry:\n  fallbackChains:\n    smol: []\n");
      expect(loadRoles({ ompFile, configDir: dir }).find(row => row.role === "smol")).toMatchObject({ model: "local/override", source: "dash", fallback: [] });
      writeFileSync(ompFile, "[invalid:");
      expect(() => loadRoles({ ompFile, configDir: dir })).toThrow("Invalid model role configuration");
    } finally { rmSync(dir, { recursive: true }); }
  });
  test("wire parser rejects malformed records", () => {
    expect(parseRoles({})).toBeNull(); expect(parseRoles([{}])).toBeNull();
    for (const [key, value] of Object.entries({ source: "secret", role: "large", health: "ok", fallback: [4], model: 4, purpose: false })) {
      expect(parseRoles([{ ...resolveRoles()[0], [key]: value }])).toBeNull();
    }
    const roles = resolveRoles(); expect(parseRoles([roles[0], roles[0]])).toBeNull();
  });
  test("HTTP is authenticated read-only, no config data leaks", async () => {
    const denied = createModelsHttpHandler({ authorize: async () => false });
    expect((await denied(new Request("http://host/models")))?.status).toBe(401);
    const handler = createModelsHttpHandler({ authorize: async () => true, roles: () => resolveRoles(), health: async () => "unknown" });
    expect(await handler(new Request("http://host/other"))).toBeNull();
    expect((await handler(new Request("http://host/models", { method: "POST" })))?.status).toBe(405);
    const response = await handler(new Request("http://host/models"));
    expect(response?.status).toBe(200); expect(parseRoles(await response?.json())?.length).toBe(17);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });
});
