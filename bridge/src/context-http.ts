import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseContext, record, type ContextSnapshot, type PlanUsage, type PlanWindow } from "../../shared/context";
import { acpContextReadings } from "./acp/context";
import { harnessTotal } from "./context-totals";
import { HermesSessions } from "./hermes-sessions";

export function parseProviderUsage(value: unknown, provider: "claude" | "codex", now = Date.now()): PlanUsage {
  const rows = Array.isArray(value) ? value : [value];
  const row = rows.find(r => record(r) && r.provider === provider);
  const usage = record(row) && record(row.usage) ? row.usage : undefined;
  const windows: PlanWindow[] = [];
  const add = (label: string, value: unknown) => {
    if (!record(value) || typeof value.usedPercent !== "number" || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100) return;
    const resetsAt = typeof value.resetsAt === "string" && Number.isFinite(Date.parse(value.resetsAt)) ? value.resetsAt : undefined;
    windows.push({ label, percent: value.usedPercent, ...(resetsAt ? { resetsAt } : {}) });
  };
  add("Session limit", usage?.primary);
  add("Weekly limit", usage?.secondary);
  // CodexBar's tertiary window is the model-scoped weekly allowance, not model token share.
  add("Model allowance", usage?.tertiary);
  if (Array.isArray(usage?.extraRateWindows)) for (const item of usage.extraRateWindows) {
    if (record(item) && typeof item.title === "string" && item.title.length <= 80 && /^[\w .()%/-]+$/.test(item.title)) add(item.title, item.window);
  }
  const weekly = usage?.secondary;
  let burn: PlanUsage["burn"];
  if (record(weekly) && typeof weekly.usedPercent === "number" && weekly.usedPercent >= 0 && weekly.usedPercent <= 100 && typeof weekly.resetsAt === "string" && typeof weekly.windowMinutes === "number" && Number.isFinite(weekly.windowMinutes) && weekly.windowMinutes > 0) {
    const left = (Date.parse(weekly.resetsAt) - now) / 3_600_000;
    const elapsed = weekly.windowMinutes / 60 - left;
    if (left > 0 && elapsed > 0) {
      const observed = weekly.usedPercent / elapsed;
      const sustainable = (100 - weekly.usedPercent) / left;
      burn = { observed, sustainable, ...(sustainable > 0 ? { ratio: observed / sustainable } : {}) };
    }
  }
  // Explicit projection: never return identity, OAuth, credentials or raw provider output.
  return { provider, windows, ...(burn ? { burn } : {}), ...(!windows.length ? { unavailable: true } : {}) };
}

export async function providerUsage(provider: "claude" | "codex"): Promise<PlanUsage> {
  try {
  const child = Bun.spawn(["codexbar", "usage", "--provider", provider, "--source", "oauth", "--json-only"], { stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => child.kill(), 15_000);
  try {
    const text = await new Response(child.stdout).text();
    if (await child.exited !== 0) throw new Error("unavailable");
    const value: unknown = JSON.parse(text);
    return parseProviderUsage(value, provider);
  } catch { return { provider, windows: [], unavailable: true }; }
  finally { clearTimeout(timer); }
  } catch { return { provider, windows: [], unavailable: true }; }
}

export function planCache(read = providerUsage, now = Date.now) {
  const providers: ("claude" | "codex")[] = ["claude", "codex"];
  let entry: { at: number; promise: Promise<PlanUsage[]> } | undefined;
  return () => {
    if (!entry || now() - entry.at >= 60_000) entry = { at: now(), promise: Promise.all(providers.map(async provider => {
      try { return await read(provider); } catch { return { provider, windows: [], unavailable: true }; }
    })) };
    return entry.promise;
  };
}

export async function nativeContext(home: string, session: string): Promise<ContextSnapshot | undefined> {
  const source = process.env.DASH_HERMES_SOURCE ?? join(homedir(), ".hermes", "hermes-agent");
  const python = process.env.DASH_HERMES_PYTHON ?? join(source, "venv", "bin", "python");
  const child = Bun.spawn([python, fileURLToPath(new URL("./context-snapshot.py", import.meta.url)), session], {
    env: { ...process.env, HERMES_HOME: home, DASH_HERMES_SOURCE: source, PYTHONDONTWRITEBYTECODE: "1" }, stdout: "pipe", stderr: "ignore",
  });
  const timer = setTimeout(() => child.kill(), 10_000);
  try {
    const text = await new Response(child.stdout).text();
    if (await child.exited !== 0) return;
    const value: unknown = JSON.parse(text);
    return parseContext(value);
  } catch { return; } finally { clearTimeout(timer); }
}

export async function nativeCompact(home: string, session: string): Promise<{ ok: boolean; code: string }> {
  const env: Record<string, string | undefined> = { ...process.env, HERMES_HOME: home };
  delete env.HERMES_TUI_GATEWAY_URL;
  const child = Bun.spawn(["python3", fileURLToPath(new URL("./context-compact.py", import.meta.url))], { env, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  child.stdin.write(JSON.stringify({ session_id: session }));
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 250_000);
  try {
    const value: unknown = JSON.parse(await new Response(child.stdout).text());
    if (await child.exited !== 0 || !record(value) || typeof value.ok !== "boolean" || typeof value.code !== "string") throw new Error("unknown");
    return { ok: value.ok, code: value.code };
  } catch { return { ok: false, code: "outcome_unknown" }; } finally { clearTimeout(timer); }
}

/** Session compaction mutates the transcript, so it is opt-in per host (DASH_CONTEXT_COMPACTION=1). */
export function compactionEnabled(env: Record<string, string | undefined> = process.env): boolean { return env.DASH_CONTEXT_COMPACTION === "1"; }

export function contextHttp(options: { sessions?: HermesSessions; read?: typeof nativeContext; plans?: () => Promise<PlanUsage[]>; compact?: typeof nativeCompact; compaction?: boolean } = {}) {
  const sessions = options.sessions ?? new HermesSessions();
  const plans = options.plans ?? planCache();
  const pending = new Set<string>();
  return async (request: Request, authorized: boolean): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const usageSheet = url.pathname === "/chat/usage";
    const compress = url.pathname === "/chat/context/compact";
    if (url.pathname !== "/chat/context" && !compress && !usageSheet) return;
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
    if (!authorized) return json({ error: "unauthorized" }, 401);
    // Read-only by default: a host that does not opt into compaction answers explicitly so clients
    // show "unavailable" instead of a 404/guess; nothing is read or executed.
    if (compress && options.compaction !== true) return json({ ok: false, code: "unavailable", error: "Compaction is not available on this host" }, 501);
    if (request.method !== (compress ? "POST" : "GET")) return json({ error: "method not allowed" }, 405);
    const session = url.searchParams.get("session");
    const profile = url.searchParams.get("profile");
    const harness = url.searchParams.get("harness") ?? "hermes";
    if (!session || session.length > 256 || !profile || profile.length > 1024) return json({ error: "invalid identity" }, 400);
    if (compress && !options.compact) return json({ ok: false, code: "unavailable" }, 501);
    if (harness !== "hermes") return compress ? json({ error: "Unsupported harness" }, 400) : json({ context: acpContextReadings.read(harness, session, harnessTotal(harness, session)) ?? null, plans: usageSheet ? await plans() : [], compactionSupported: false });
    // Native resolution only: no profile APIs, gateway discovery or credential reads.
    const home = sessions.nativeHome(profile, session);
    if (!home) return json({ error: "session not found" }, 404);
    if (compress) {
      const key = `${home}\0${session}`;
      if (pending.has(key)) return json({ error: "Compaction already requested" }, 409);
      pending.add(key);
      try {
        const before = await (options.read ?? nativeContext)(home, session);
        if (!before) return json({ error: "Context unavailable; nothing sent" }, 503);
        const receipt = await (options.compact ?? nativeCompact)(home, before.sessionId);
        const after = await (options.read ?? nativeContext)(home, before.sessionId);
        return json({ ...receipt, context: after ?? null }, receipt.ok ? 200 : 409);
      } catch { return json({ error: "Outcome unknown. Check the session before retrying." }, 503); }
      finally { pending.delete(key); }
    }
    try {
      const [context, usage] = await Promise.all([(options.read ?? nativeContext)(home, session), usageSheet ? plans() : Promise.resolve([])]);
      return json({ context: acpContextReadings.read(harness, session, context) ?? null, plans: usage, compactionSupported: Boolean(options.compact) });
    } catch { return json({ error: "Context unavailable" }, 503); }
  };
}
