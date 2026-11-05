import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalRole, record, ROLE_PURPOSES, type ModelRole, type ResolvedRole } from "../../shared/model-roles";

interface Layer { models: Partial<Record<ModelRole, string>>; chains: Partial<Record<ModelRole, string[]>> }
const selector = (value: unknown): value is string => typeof value === "string" && /^(?:@[a-z]+|[a-z0-9_.-]+\/[a-zA-Z0-9_./:@+-]+)$/.test(value);
export function roleLayer(value: unknown): Layer {
  const layer: Layer = { models: {}, chains: {} };
  if (!record(value)) return layer;
  if (record(value.modelRoles)) for (const [key, model] of Object.entries(value.modelRoles)) {
    const role = canonicalRole(key);
    if (role && selector(model)) layer.models[role] = model;
  }
  const chains = record(value.retry) && record(value.retry.fallbackChains) ? value.retry.fallbackChains : {};
  for (const [key, chain] of Object.entries(chains)) {
    const role = canonicalRole(key);
    if (role && Array.isArray(chain) && chain.every(selector)) layer.chains[role] = chain;
  }
  return layer;
}
export function resolveRoles(omp: unknown = {}, dash: unknown = {}): ResolvedRole[] {
  const o = roleLayer(omp), d = roleLayer(dash);
  const defaults: Partial<Record<ModelRole, string>> = {
    tiny: "local/qwen3-4b-q4km", smol: "openai-codex/gpt-6-luna",
    default: "openai-codex/gpt-6.1-sol", judge: "typesafe/jev-latest",
  };
  const modelFor = (role: ModelRole, seen: Set<ModelRole> = new Set()): string => {
    if (seen.has(role)) throw new Error("Model role reference cycle");
    seen.add(role);
    const kindOnly = role === "image" || role === "web" || role === "speech" || role === "dictation";
    const value = d.models[role] ?? o.models[role] ?? defaults[role] ?? (kindOnly ? "" : "@default");
    if (!value.startsWith("@")) return value;
    const target = canonicalRole(value);
    if (!target) throw new Error("Unknown model role reference");
    return modelFor(target, seen);
  };
  const defaultChains: Partial<Record<ModelRole, string[]>> = {
    tiny: ["typesafe/jev-latest", "@smol"], smol: ["openai-codex/gpt-6-luna"], judge: ["@default"],
  };
  const fallbackFor = (role: ModelRole, seen: Set<ModelRole> = new Set()): string[] => {
    if (seen.has(role)) return [];
    seen.add(role);
    return (d.chains[role] ?? o.chains[role] ?? defaultChains[role] ?? []).flatMap(value => {
      if (!value.startsWith("@")) return [value];
      const target = canonicalRole(value);
      return target && !seen.has(target) ? [modelFor(target), ...fallbackFor(target, new Set(seen))] : [];
    });
  };
  return Object.keys(ROLE_PURPOSES).flatMap(key => {
    const role = canonicalRole(key);
    if (!role) return [];
    const model = modelFor(role);
    return [{ role, model, purpose: ROLE_PURPOSES[role], source: d.models[role] ? "dash" : o.models[role] ? "omp" : "default",
      fallback: [...new Set(fallbackFor(role))].filter(value => value !== model), health: "unknown" } satisfies ResolvedRole];
  });
}
export function loadRoles(options: { ompFile?: string; configDir?: string } = {}): ResolvedRole[] {
  const read = (file: string): unknown => {
    try { return Bun.YAML.parse(readFileSync(file, "utf8")); }
    catch (error) {
      if (record(error) && error.code === "ENOENT") return {};
      // Never echo parser errors, which can include unrelated credential lines.
      throw new Error("Invalid model role configuration");
    }
  };
  return resolveRoles(read(options.ompFile ?? join(homedir(), ".omp/agent/config.yml")),
    read(join(options.configDir ?? process.env.DASH_CONFIG_DIR ?? join(homedir(), ".dash"), "model-roles.yml")));
}
