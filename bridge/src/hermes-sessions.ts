import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, HistoryMessage } from "../../shared/protocol";
import { parseHermesEnvFile, type EnvMap, type HermesFetch } from "./hermes-session";
import { hostProcesses, ownerOf, readLiveOwners, surfaceLabel, type LiveOwner } from "./hermes-owner";
import { hostGatewayProbe, ownerHosting, type GatewayHostProbe, type OwnerHosting } from "./hermes-gateway-host";

// Deliberate allowlist: interactive surfaces and messaging platforms, never kitchen,
// cron, oneshot, kanban, tool or delegated workers. `local` is native session authority CLI.
export const HERMES_CHAT_SOURCES = ["local", "cli", "tui", "desktop", "acp", "api_server", "telegram", "discord", "slack", "whatsapp", "signal", "matrix", "email", "sms", "imessage", "mattermost", "dingtalk", "feishu", "wecom", "qq", "teams", "irc", "web", "gateway"];
const SOURCES = new Set(HERMES_CHAT_SOURCES);
const RECENT_LIMIT = 50;
const SESSION_FIELDS = "id,source,title,started_at,last_activity_at,message_count,cwd,archived,hidden,parent_session_id,end_reason,model_config";
const PROFILE_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export type HermesApi = { url: string; key: string };
type Profile = { id: string; home: string; api?: HermesApi };
type Row = Record<string, unknown>;
function record(value: unknown): value is Row { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readEnv(path: string): EnvMap { try { return parseHermesEnvFile(readFileSync(path, "utf8")); } catch { return {}; } }
function stamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value * 1000;
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}
function visible(row: Row): boolean {
  if (typeof row.source !== "string" || !SOURCES.has(row.source) || row.archived || row.hidden || row.is_internal_child) return false;
  try {
    const config: unknown = typeof row.model_config === "string" ? JSON.parse(row.model_config) : undefined;
    if (record(config) && config._delegate_from !== undefined) return false;
  } catch { /* older config */ }
  return true;
}
function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(block => record(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
}
export function hermesSessionAgentId(profile: string, session: string): string { return `hermes:session:${encodeURIComponent(profile)}:${encodeURIComponent(session)}`; }
function toAgent(row: Row, profile: Profile, owner?: LiveOwner): AgentInfo | undefined {
  if (!visible(row) || typeof row.id !== "string") return undefined;
  const title = typeof row.title === "string" && row.title.trim() ? row.title : `Hermes · ${profile.id}`;
  return { id: hermesSessionAgentId(profile.id, row.id), name: title, kind: "hermes", status: "available", sessionId: row.id, profileId: profile.id,
    detail: `${profile.id} · ${String(row.source)}`, source: String(row.source), cwd: typeof row.cwd === "string" ? row.cwd : undefined,
    lastActivityAt: stamp(row.last_active ?? row.last_activity_at ?? row.started_at), messageCount: typeof row.message_count === "number" ? row.message_count : 0,
    ...(owner ? { openIn: surfaceLabel(owner.surface) } : {}) };
}
export function parseHermesHistory(rows: unknown): HistoryMessage[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): HistoryMessage[] => {
    if (!record(row) || (row.role !== "user" && row.role !== "assistant") || row.active === 0) return [];
    const content = text(row.content);
    if (!content.trim() || (typeof row.id !== "string" && typeof row.id !== "number")) return [];
    return [{ id: String(row.id), role: row.role, text: content, at: stamp(row.timestamp) }];
  });
}
function withDb<T>(profile: Profile, fn: (db: Database) => T): T | undefined {
  if (!existsSync(join(profile.home, "state.db"))) return undefined;
  let db: Database | undefined;
  try {
    // z0live's read-only boundary. Never initialize/migrate the native database.
    db = new Database(join(profile.home, "state.db"), { readonly: true });
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=300;");
    return fn(db);
  } catch { return undefined; } finally { db?.close(); }
}
function localRows(profile: Profile): Row[] {
  return withDb(profile, db => db.query<Row, []>(`SELECT ${SESSION_FIELDS} FROM sessions WHERE coalesce(archived,0)=0 AND coalesce(hidden,0)=0
    AND source IN (${HERMES_CHAT_SOURCES.map(s => `'${s}'`).join(",")})
    ORDER BY coalesce(last_activity_at,started_at) DESC LIMIT ${RECENT_LIMIT}`).all()) ?? [];
}
function localSession(profile: Profile, id: string): Row | undefined {
  return withDb(profile, db => db.query<Row, [string]>(`SELECT ${SESSION_FIELDS} FROM sessions WHERE id=?`).get(id) ?? undefined);
}
// Compression continuations only, never delegate children. Bounded lineage walk.
function lineageIds(db: Database, id: string): Set<string> {
  let tip = id;
  const ids = new Set<string>([id]);
  for (let n = 0; n < 64; n++) {
    const row = db.query<Row, [string]>(`SELECT ${SESSION_FIELDS} FROM sessions WHERE id=?`).get(tip);
    if (!row || row.end_reason !== "compression") break;
    const child = db.query<Row, [string]>(`SELECT ${SESSION_FIELDS} FROM sessions WHERE parent_session_id=? AND coalesce(archived,0)=0 AND coalesce(hidden,0)=0 AND source IN (${HERMES_CHAT_SOURCES.map(s => `'${s}'`).join(",")}) ORDER BY started_at DESC LIMIT 1`).get(tip);
    if (!child || !visible(child) || typeof child.id !== "string" || ids.has(child.id)) break;
    tip = child.id; ids.add(tip);
  }
  let cursor = id;
  for (let n = 0; n < 64; n++) {
    const row = db.query<Row, [string]>("SELECT parent_session_id FROM sessions WHERE id=?").get(cursor);
    if (typeof row?.parent_session_id !== "string" || ids.has(row.parent_session_id)) break;
    const parent = db.query<Row, [string]>(`SELECT ${SESSION_FIELDS} FROM sessions WHERE id=?`).get(row.parent_session_id);
    if (!parent || parent.end_reason !== "compression" || !visible(parent)) break;
    cursor = row.parent_session_id; ids.add(cursor);
  }
  return ids;
}
/**
 * Under session authority a fresh classic CLI leases its own live id, and its transcript
 * is a separate `local-*` row created in the same instant (the registry stores no link).
 * Map such a lease to the one interactive row that started within 1.5 s of it. Ambiguity
 * maps to nothing. This only ever withholds writes, so a miss is the unsafe direction.
 */
const OWNER_MATCH_WINDOW_S = 1.5;
export function ownerSessionIds(db: Database, owner: LiveOwner): Set<string> {
  const direct = db.query<Row, [string]>("SELECT id FROM sessions WHERE id=?").get(owner.sessionId);
  if (direct || owner.startedAt === undefined) return lineageIds(db, owner.sessionId);
  let rows: Row[] = [];
  const window = [owner.startedAt - OWNER_MATCH_WINDOW_S, owner.startedAt + OWNER_MATCH_WINDOW_S] as const;
  try {
    rows = db.query<Row, [number, number]>("SELECT id FROM sessions WHERE started_at BETWEEN ? AND ? AND coalesce(created_source, source) IN ('cli','tui','local') AND parent_session_id IS NULL").all(...window);
  } catch {
    rows = db.query<Row, [number, number]>("SELECT id FROM sessions WHERE started_at BETWEEN ? AND ? AND source IN ('cli','tui','local') AND parent_session_id IS NULL").all(...window);
  }
  const only = rows.length === 1 ? rows[0]?.id : undefined;
  return typeof only === "string" ? lineageIds(db, only) : new Set([owner.sessionId]);
}
function localHistory(profile: Profile, id: string): HistoryMessage[] {
  return withDb(profile, db => {
    const args = [...lineageIds(db, id)];
    const rows = db.query<Row, string[]>(`SELECT id,role,content,timestamp FROM messages WHERE session_id IN (${args.map(() => "?").join(",")})
      AND active=1 AND role IN ('user','assistant') AND length(trim(coalesce(content,'')))>0 ORDER BY timestamp DESC,id DESC LIMIT 200`).all(...args);
    return parseHermesHistory(rows.reverse());
  }) ?? [];
}
function loopbackUrl(raw: string): string | undefined {
  try { const url = new URL(raw); return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash ? raw.replace(/\/+$/, "") : undefined; } catch { return undefined; }
}

export class HermesSessions {
  private readonly known = new Set<string>();
  private readonly root: string;
  private readonly env: EnvMap;
  private readonly fetch: HermesFetch;
  private readonly processes: typeof hostProcesses;
  private readonly gateways: GatewayHostProbe;
  constructor(options: { root?: string; env?: EnvMap; fetch?: HermesFetch; processes?: typeof hostProcesses; gateways?: GatewayHostProbe } = {}) {
    this.env = options.env ?? process.env;
    this.root = options.root ?? this.env.DASH_HERMES_ROOT ?? join(homedir(), ".hermes");
    this.fetch = options.fetch ?? globalThis.fetch;
    this.processes = options.processes ?? hostProcesses;
    this.gateways = options.gateways ?? hostGatewayProbe(this.root, pid => this.processes.alive(pid));
  }
  private profiles(): Profile[] {
    // "default" names the root home. A stray profiles/default directory would be a second
    // "default" and make every default session ambiguous once the roster has listed it.
    const profiles: Profile[] = [{ id: "default", home: this.root }];
    try { for (const entry of readdirSync(join(this.root, "profiles"), { withFileTypes: true })) if ((entry.isDirectory() || entry.isSymbolicLink()) && PROFILE_OK.test(entry.name) && entry.name !== "default") profiles.push({ id: entry.name, home: join(this.root, "profiles", entry.name) }); } catch { /* no named profiles */ }
    let overrides: unknown;
    try { overrides = JSON.parse(this.env.DASH_HERMES_APIS ?? "{}"); } catch { /* fail closed */ }
    const seen = new Set<string>();
    return profiles.filter(profile => {
      try { const path = realpathSync(profile.home); if (seen.has(path)) return false; seen.add(path); } catch { return false; }
      const env = readEnv(join(profile.home, ".env"));
      const url = loopbackUrl(`http://${env.API_SERVER_HOST || "127.0.0.1"}:${env.API_SERVER_PORT || "8642"}`);
      if (url && env.API_SERVER_KEY) profile.api = { url, key: env.API_SERVER_KEY };
      const override = record(overrides) ? overrides[profile.id] : undefined;
      if (record(override) && typeof override.url === "string" && typeof override.keyFile === "string") {
        const origin = loopbackUrl(override.url);
        if (origin) try { const key = readFileSync(override.keyFile, "utf8").trim(); if (key) profile.api = { url: origin, key }; } catch { /* absent key = no override */ }
      }
      return true;
    });
  }
  private async get(profile: Profile, path: string): Promise<unknown> {
    if (!profile.api) throw new Error("No profile API");
    const response = await this.fetch(`${profile.api.url}${path}`, { headers: { Authorization: `Bearer ${profile.api.key}` }, signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error(`Hermes read HTTP ${response.status}`);
    const body: unknown = await response.json();
    return body;
  }
  async list(): Promise<AgentInfo[]> {
    const lists = await Promise.all(this.profiles().map(async profile => {
      const local = localRows(profile);
      let rows = local;
      if (profile.api) try {
        // Named profiles often copy default's API port/key. Verify a native id
        // before trusting that endpoint, otherwise it could leak default's roster.
        const probe = local.find(visible);
        if (profile.id !== "default" && probe) {
          const body = await this.get(profile, `/api/sessions/${encodeURIComponent(String(probe.id))}`);
          if (!record(body) || !record(body.session) || body.session.id !== probe.id) throw new Error("API profile mismatch");
        }
        if (profile.id !== "default" && !probe) throw new Error("No profile identity evidence");
        const apiRows: Row[] = [];
        // Bound work even if an old server reports has_more incorrectly. Noise is
        // filtered AFTER pagination so a kitchen-heavy page cannot hide real chats.
        for (let offset = 0; offset < 2000; offset += 200) {
          const body = await this.get(profile, `/api/sessions?limit=200&offset=${offset}&include_children=false`);
          if (!record(body) || !Array.isArray(body.data)) throw new Error("Invalid session list");
          apiRows.push(...body.data.filter(record));
          if (!body.has_more) break;
        }
        rows = apiRows.filter(visible).slice(0, RECENT_LIMIT).map(row => ({ ...local.find(l => l.id === row.id) ?? (typeof row.id === "string" ? localSession(profile, row.id) : undefined), ...row }));
      } catch { /* API is optional for reads; native DB remains authoritative offline. */ }
      const seen = new Set<string>();
      // Few leases, many rows: expand each live lease over its compression lineage once.
      const heldBy = new Map<string, LiveOwner>();
      const owners = readLiveOwners(profile.home, this.processes);
      if (owners.length > 0) withDb(profile, db => { for (const owner of owners) for (const id of ownerSessionIds(db, owner)) heldBy.set(id, owner); });
      for (const owner of owners) if (!heldBy.has(owner.sessionId)) heldBy.set(owner.sessionId, owner);
      return rows.flatMap(row => { const agent = toAgent(row, profile, typeof row.id === "string" ? heldBy.get(row.id) : undefined); if (!agent || seen.has(agent.id)) return []; seen.add(agent.id); return [agent]; })
        .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)).slice(0, RECENT_LIMIT);
    }));
    const agents = lists.flat();
    this.known.clear();
    for (const agent of agents) this.known.add(agent.id);
    return agents;
  }
  async history(profileId: string, sessionId: string): Promise<HistoryMessage[]> {
    const profile = this.profiles().find(p => p.id === profileId);
    if (!profile) return [];
    const row = localSession(profile, sessionId);
    if (row && !visible(row)) return [];
    try {
      if (profile.id !== "default" && row) {
        const identity = await this.get(profile, `/api/sessions/${encodeURIComponent(sessionId)}`);
        if (!record(identity) || !record(identity.session) || identity.session.id !== sessionId) throw new Error("API profile mismatch");
      }
      if (!row) {
        const body = await this.get(profile, `/api/sessions/${encodeURIComponent(sessionId)}`);
        if (!record(body) || !record(body.session) || !visible(body.session)) return [];
      }
      const body = await this.get(profile, `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=200&order=latest`);
      if (!record(body) || !Array.isArray(body.data)) throw new Error("Invalid history");
      return parseHermesHistory(body.data);
    } catch { return row ? localHistory(profile, sessionId) : []; }
  }
  /**
   * A live CLI/TUI that holds this session (or any id in its compression lineage).
   * Dash must not write while it does: the reply waits for an ordered handoff.
   */
  liveOwner(profileId: string, sessionId: string): LiveOwner | undefined {
    const profile = this.profiles().find(p => p.id === profileId);
    if (!profile) return undefined;
    const owners = readLiveOwners(profile.home, this.processes);
    if (owners.length === 0) return undefined;
    return withDb(profile, db => {
      const target = lineageIds(db, sessionId);
      return owners.find(owner => [...ownerSessionIds(db, owner)].some(id => target.has(id)));
    }) ?? ownerOf(owners, new Set([sessionId]));
  }
  /**
   * Where `owner`'s agent runs. `gateway`: the profile's gateway hosts the session and the owner
   * is one of its viewers (or the gateway itself), so Dash sends into that gateway like any other
   * client. `standalone`: a separate process may write the session; Dash waits for the handoff.
   */
  ownerHosting(profileId: string, sessionId: string, owner: LiveOwner): OwnerHosting {
    const profile = this.profiles().find(p => p.id === profileId);
    if (!profile) return "standalone";
    return ownerHosting(owner, profile.id, profile.home, this.gateways, this.authoritySession(profile, sessionId));
  }
  /**
   * The session runs in a gateway even when no terminal holds a lease (the TUI and Desktop write
   * none): a native session-authority chat whose profile gateway is running.
   */
  gatewayHosted(profileId: string, sessionId: string): boolean {
    const profile = this.profiles().find(p => p.id === profileId);
    if (!profile || !this.authoritySession(profile, sessionId)) return false;
    try { return this.gateways.gatewayPids(profile.id, profile.home).length > 0; } catch { return false; }
  }
  private authoritySession(profile: Profile, sessionId: string): boolean {
    return withDb(profile, db => [...lineageIds(db, sessionId)].some(id => db.query<Row, [string]>("SELECT source FROM sessions WHERE id=?").get(id)?.source === "local")) ?? false;
  }
  /** Profile id whose home is `home` (e.g. the bridge's own HERMES_HOME). */
  profileForHome(home: string): string | undefined {
    let wanted: string;
    try { wanted = realpathSync(home); } catch { return undefined; }
    return this.profiles().find(p => { try { return realpathSync(p.home) === wanted; } catch { return false; } })?.id;
  }
  homeOf(profileId: string): string | undefined {
    return this.profiles().find(p => p.id === profileId)?.home;
  }
  // Resolve only host-known profile/session identities. Phone input cannot select a
  // URL, secret file or arbitrary HERMES_HOME. Existing sessions never resume via CLI.
  target(profileId: string | undefined, sessionId: string | undefined): { profile: string; api?: HermesApi } | undefined {
    if (!sessionId) return undefined;
    const matches = this.profiles().filter(p => (!profileId || profileId === p.id || profileId === hermesSessionAgentId(p.id, sessionId)) && (() => { const row = localSession(p, sessionId); return row ? visible(row) : this.known.has(hermesSessionAgentId(p.id, sessionId)); })());
    if (matches.length !== 1) return undefined;
    const match = matches[0];
    return match ? { profile: match.id, api: match.api } : undefined;
  }
}
export const hermesSessions = new HermesSessions();
