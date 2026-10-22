import { Database } from "bun:sqlite";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { allowedModel, rankRecentModels, type RecentModel } from "../../shared/recent-models";

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function route(model: unknown, raw: unknown, billing?: unknown): RecentModel | undefined {
  let config: unknown;
  try { config = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return undefined; }
  const runtime = record(config) && record(config.gateway_runtime) ? config.gateway_runtime : undefined;
  const provider = runtime?.provider ?? (record(config) ? config.provider : undefined) ?? billing;
  const id = runtime?.model ?? model;
  if (!allowedModel(provider, id) || typeof id !== "string") return undefined;
  return { provider, model: id, count: 1 };
}
export function modelProfileHome(root: string, profile: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profile)) throw new Error("Invalid profile");
  const base = realpathSync(root);
  const home = realpathSync(profile === "default" ? root : join(root, "profiles", profile));
  const rel = relative(base, home);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Profile outside root");
  return home;
}
export function readRecentModels(home: string, now = Date.now(), session?: string) {
  const db = new Database(join(home, "state.db"), { readonly: true });
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=300;");
    const columns = db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().map(c => c.name);
    const billing = columns.includes("billing_provider") ? "billing_provider" : "NULL AS billing_provider";
    const cutoff = (now - 14 * 24 * 60 * 60 * 1000) / 1000;
    const rows = db.query<{ model: unknown; model_config: unknown; billing_provider: unknown }, [number]>(`SELECT model,model_config,${billing} FROM sessions WHERE started_at >= ? AND started_at <= ${now / 1000} ORDER BY started_at DESC LIMIT 100001`).all(cutoff);
    const models = rankRecentModels(rows.slice(0, 100000).flatMap(row => {
      const value = route(row.model, row.model_config, row.billing_provider);
      return value ? [value] : [];
    }));
    const currentRow = session ? db.query<{ model: unknown; model_config: unknown; billing_provider: unknown }, [string]>(`SELECT model,model_config,${billing} FROM sessions WHERE id=?`).get(session) : undefined;
    const current = currentRow ? route(currentRow.model, currentRow.model_config, currentRow.billing_provider) : undefined;
    const catalog: RecentModel[] = [];
    try {
      const path = join(home, "provider_models_cache.json");
      if (statSync(path).size > 4 * 1024 * 1024) throw new Error("Cache too large");
      const cache: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (record(cache)) for (const [provider, entry] of Object.entries(cache)) {
        if (!record(entry) || !Array.isArray(entry.models)) continue;
        for (const model of entry.models) if (allowedModel(provider, model) && typeof model === "string") catalog.push({ provider, model, count: 0 });
      }
    } catch { /* Optional metadata only. No credentials/config files are read. */ }
    return { models, catalog: rankRecentModels(catalog), current: current ?? null, truncated: rows.length > 100000, windowDays: 14, asOf: now,
      canApply: false, applyBlocker: "The current chat transport does not expose a qualified session-scoped model command. No model change has been sent." };
  } finally { db.close(); }
}
export function createRecentModelsHttpHandler(options: { authorize(request: Request): Promise<boolean>; root?: string; now?(): number }) {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== "/models/recent") return null;
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
    if (!await options.authorize(request)) return json({ error: "unauthorized" }, 401);
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    const profile = url.searchParams.get("profile") ?? "default";
    const session = url.searchParams.get("session") ?? undefined;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profile) || (session && !/^[A-Za-z0-9_.-]{1,256}$/.test(session))) return json({ error: "invalid target" }, 400);
    try { return json(readRecentModels(modelProfileHome(options.root ?? process.env.DASH_HERMES_ROOT ?? join(homedir(), ".hermes"), profile), options.now?.(), session)); }
    catch { return json({ error: "Model history unavailable" }, 503); }
  };
}
