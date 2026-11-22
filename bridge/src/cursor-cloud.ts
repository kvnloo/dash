// Cursor cloud agents (Cursor's public background-agents API, v0) as a Dash harness.
//
// A Dash chat with this harness is one cloud agent. The first turn launches it
// (`POST /v0/agents` on a GitHub repository); later turns are follow-ups
// (`POST /v0/agents/{id}/followup`). The bridge polls the agent and its conversation and
// turns new assistant messages into reply text. The agent id is the chat's session id.
//
// The API key comes only from the host env (`CURSOR_API_KEY`) and is never logged or sent to
// the phone. `DASH_CURSOR_API_URL` points at another origin (the army's fixture server).
import { spawnSync } from "node:child_process";
import type { AgentInfo, HarnessInfo } from "../../shared/protocol";
import type { Sink, TurnInput } from "./harnesses";

export const CURSOR_CLOUD_ID = "cursor-cloud";
export const CURSOR_CLOUD_NAME = "Cursor Cloud";
const DEFAULT_API = "https://api.cursor.com";
/** Cursor cloud agent ids are short opaque tokens (`bc_…`); anything else is refused before a URL is built. */
const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

type Env = Record<string, string | undefined>;
export type CursorFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type CursorAgentStatus = "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "EXPIRED";
export interface CursorAgent { id: string; name: string; status: CursorAgentStatus; repository?: string; createdAt?: number; summary?: string; url?: string }
export interface CursorMessage { id: string; type: "user_message" | "assistant_message"; text: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value: unknown): value is string { return typeof value === "string"; }
const STATUSES: readonly CursorAgentStatus[] = ["CREATING", "RUNNING", "FINISHED", "ERROR", "EXPIRED"];
function agentStatus(value: unknown): CursorAgentStatus | undefined { return STATUSES.find(s => s === value); }

export function isCursorAgentId(id: string): boolean { return AGENT_ID.test(id); }

export function parseAgent(raw: unknown): CursorAgent | null {
  if (!record(raw) || !str(raw.id) || !AGENT_ID.test(raw.id)) return null;
  const s = agentStatus(raw.status);
  if (!s) return null;
  const source = record(raw.source) ? raw.source : undefined;
  const target = record(raw.target) ? raw.target : undefined;
  const created = str(raw.createdAt) ? Date.parse(raw.createdAt) : NaN;
  return {
    id: raw.id,
    name: str(raw.name) && raw.name.trim() ? raw.name.trim() : raw.id,
    status: s,
    ...(source && str(source.repository) ? { repository: source.repository } : {}),
    ...(Number.isFinite(created) ? { createdAt: created } : {}),
    ...(str(raw.summary) ? { summary: raw.summary } : {}),
    ...(target && str(target.url) ? { url: target.url } : {}),
  };
}

export function parseConversation(raw: unknown): CursorMessage[] {
  if (!record(raw) || !Array.isArray(raw.messages)) return [];
  const out: CursorMessage[] = [];
  for (const m of raw.messages) {
    if (!record(m) || !str(m.id) || !str(m.text)) continue;
    if (m.type !== "user_message" && m.type !== "assistant_message") continue;
    out.push({ id: m.id, type: m.type, text: m.text });
  }
  return out;
}

export function cursorConfigured(env: Env = process.env): boolean {
  return Boolean(env.CURSOR_API_KEY?.trim());
}

/** The harness row the bridge reports. Listed even without a key, so the phone can say what is missing. */
export function cursorHarnessInfo(env: Env = process.env): HarnessInfo {
  const available = cursorConfigured(env);
  return { id: CURSOR_CLOUD_ID, name: CURSOR_CLOUD_NAME, available, where: "cloud", ...(available ? {} : { hint: "Set CURSOR_API_KEY on the host to start Cursor cloud agents." }) };
}

/** `git@github.com:o/r.git`, `https://github.com/o/r(.git)` -> `https://github.com/o/r`. Other hosts are refused. */
export function githubRepository(remote: string): string | undefined {
  const text = remote.trim();
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(text);
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

/** Which repository a new cloud agent works on: `DASH_CURSOR_REPOSITORY`, else the chat folder's GitHub origin. */
export function cursorRepository(cwd: string, env: Env = process.env, gitRemote: (cwd: string) => string | undefined = originUrl): string | undefined {
  const configured = env.DASH_CURSOR_REPOSITORY?.trim();
  if (configured) return githubRepository(configured) ?? configured;
  const remote = gitRemote(cwd);
  return remote ? githubRepository(remote) : undefined;
}

function originUrl(cwd: string): string | undefined {
  try {
    const r = spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 3000 });
    return r.status === 0 ? r.stdout.trim() : undefined;
  } catch { return undefined; }
}

export class CursorCloud {
  constructor(private readonly env: Env = process.env, private readonly fetcher: CursorFetch = (url, init) => globalThis.fetch(url, init)) {}

  private base(): string { return (this.env.DASH_CURSOR_API_URL?.trim() || DEFAULT_API).replace(/\/+$/, ""); }

  private async call(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    const key = this.env.CURSOR_API_KEY?.trim();
    if (!key) throw new Error("CURSOR_API_KEY is not set on the host.");
    const response = await this.fetcher(`${this.base()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const raw = await response.json();
        if (record(raw) && str(raw.error)) detail = `: ${raw.error.slice(0, 200)}`;
        else if (record(raw) && record(raw.error) && str(raw.error.message)) detail = `: ${raw.error.message.slice(0, 200)}`;
      } catch { /* no body */ }
      throw new Error(`Cursor API ${method} ${path.replace(/\/agents\/[^/?]+/, "/agents/{id}")} returned HTTP ${response.status}${detail}`);
    }
    return response.json();
  }

  async launch(text: string, repository: string, signal?: AbortSignal): Promise<CursorAgent> {
    const ref = this.env.DASH_CURSOR_REF?.trim();
    const model = this.env.DASH_CURSOR_MODEL?.trim();
    const agent = parseAgent(await this.call("POST", "/v0/agents", { prompt: { text }, source: { repository, ...(ref ? { ref } : {}) }, ...(model ? { model } : {}) }, signal));
    if (!agent) throw new Error("Cursor API returned no agent.");
    return agent;
  }

  async followup(id: string, text: string, signal?: AbortSignal): Promise<void> {
    if (!AGENT_ID.test(id)) throw new Error("Not a Cursor cloud agent id.");
    await this.call("POST", `/v0/agents/${id}/followup`, { prompt: { text } }, signal);
  }

  async agent(id: string, signal?: AbortSignal): Promise<CursorAgent> {
    if (!AGENT_ID.test(id)) throw new Error("Not a Cursor cloud agent id.");
    const agent = parseAgent(await this.call("GET", `/v0/agents/${id}`, undefined, signal));
    if (!agent) throw new Error("Cursor API returned an unreadable agent.");
    return agent;
  }

  async conversation(id: string, signal?: AbortSignal): Promise<CursorMessage[]> {
    if (!AGENT_ID.test(id)) throw new Error("Not a Cursor cloud agent id.");
    return parseConversation(await this.call("GET", `/v0/agents/${id}/conversation`, undefined, signal));
  }

  async stop(id: string): Promise<void> {
    if (!AGENT_ID.test(id)) return;
    try { await this.call("POST", `/v0/agents/${id}/stop`); } catch { /* best effort */ }
  }

  async list(limit = 20): Promise<CursorAgent[]> {
    const raw = await this.call("GET", `/v0/agents?limit=${limit}`, undefined, AbortSignal.timeout(3000));
    if (!record(raw) || !Array.isArray(raw.agents)) return [];
    return raw.agents.map(parseAgent).filter((a): a is CursorAgent => a !== null);
  }
}

const TERMINAL: readonly CursorAgentStatus[] = ["FINISHED", "ERROR", "EXPIRED"];

export interface CursorTurnOptions {
  client: CursorCloud;
  input: TurnInput;
  sink: Sink;
  signal: AbortSignal;
  timeoutMs: number;
  pollMs?: number;
  repository?: (cwd: string) => string | undefined;
}

export const CURSOR_CANCELLED = 130;

/**
 * One turn: launch or follow up, then poll until the agent stops. Every assistant message that
 * appears after the turn began becomes reply text. Resolves with the exit code.
 */
export async function runCursorTurn(o: CursorTurnOptions): Promise<number> {
  const pollMs = o.pollMs ?? Math.max(100, Number(process.env.DASH_CURSOR_POLL_MS) || 3000);
  const deadline = Date.now() + o.timeoutMs;
  const sleep = (ms: number) => new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms);
    o.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
  let id = o.input.sessionId;
  const seen = new Set<string>();
  if (id) {
    for (const m of await o.client.conversation(id, o.signal)) seen.add(m.id);
    o.sink.session(id);
    o.sink.status("Sending follow-up to Cursor");
    await o.client.followup(id, o.input.text, o.signal);
  } else {
    const repository = (o.repository ?? (cwd => cursorRepository(cwd)))(o.input.cwd);
    if (!repository) throw new Error("Cursor cloud agents work on a GitHub repository. Start this chat in a folder with a GitHub origin, or set DASH_CURSOR_REPOSITORY on the host.");
    o.sink.status("Launching Cursor cloud agent");
    const agent = await o.client.launch(o.input.text, repository, o.signal);
    id = agent.id;
    invalidateCursorRoster();
    o.sink.session(id);
  }
  let active = false;
  let wrote = false;
  let last: CursorAgentStatus | undefined;
  while (!o.signal.aborted) {
    const agent = await o.client.agent(id, o.signal);
    const messages = await o.client.conversation(id, o.signal);
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (m.type !== "assistant_message" || !m.text) continue;
      o.sink.delta(wrote ? `\n\n${m.text}` : m.text);
      wrote = true;
    }
    if (agent.status !== last) {
      last = agent.status;
      o.sink.status(TERMINAL.includes(agent.status) ? "" : `Cursor agent ${agent.status.toLowerCase()}`);
    }
    if (!TERMINAL.includes(agent.status)) active = true;
    // A follow-up can be read back before the agent leaves its last FINISHED state; take a
    // terminal state as this turn's end only after a new message or a non-terminal state.
    else if (active || wrote) {
      if (agent.status === "FINISHED") {
        if (!wrote && agent.summary) o.sink.delta(agent.summary);
        return 0;
      }
      o.sink.error(agent.status === "EXPIRED" ? "The Cursor cloud agent expired." : `The Cursor cloud agent stopped with an error${agent.summary ? `: ${agent.summary}` : "."}`);
      return 1;
    }
    if (Date.now() > deadline) {
      o.sink.error("The Cursor cloud agent did not finish in time. It may still be running in Cursor.");
      return 1;
    }
    await sleep(pollMs);
  }
  return CURSOR_CANCELLED;
}

let listCache: { at: number; agents: AgentInfo[] } | undefined;
let listing: Promise<void> | undefined;

/**
 * Recent cloud agents as roster rows (one chat each). Never blocks the roster: it returns the
 * last good list and refreshes in the background. No key, no rows.
 */
export function cursorRosterAgents(env: Env = process.env, client = new CursorCloud(env), now = Date.now()): AgentInfo[] {
  if (!cursorConfigured(env)) return [];
  if ((!listCache || now - listCache.at > 15000) && !listing) {
    listing = client.list().then(
      agents => { listCache = { at: Date.now(), agents: agents.map(cursorAgentInfo) }; },
      () => { listCache = { at: Date.now(), agents: listCache?.agents ?? [] }; },
    ).finally(() => { listing = undefined; });
  }
  return listCache?.agents ?? [];
}

/** Forget the cached list so the next roster read refetches (after a launch). */
export function invalidateCursorRoster(): void { listCache = undefined; }

export function cursorProfileId(agentId: string): string { return `${CURSOR_CLOUD_ID}:${agentId}`; }

export function cursorAgentInfo(agent: CursorAgent): AgentInfo {
  return {
    id: cursorProfileId(agent.id),
    name: agent.name,
    kind: CURSOR_CLOUD_ID,
    status: agent.status === "RUNNING" || agent.status === "CREATING" ? "running" : "available",
    detail: agent.repository ? agent.repository.replace(/^https:\/\/github\.com\//, "") : "Cursor cloud agent",
    sessionId: agent.id,
    source: "cursor-cloud",
    ...(agent.createdAt ? { lastActivityAt: agent.createdAt } : {}),
  };
}
