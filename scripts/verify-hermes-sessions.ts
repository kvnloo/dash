#!/usr/bin/env bun
/** Read-only live proof. Owns only its loopback bridge and disposable credentials. */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseHosts, parseServerMessage, type ServerMessage } from "../shared/protocol";
import { mergeLiveConversations } from "../app/src/lib/live-sessions";

const sessionId = process.env.DASH_VERIFY_HERMES_SESSION;
const profile = process.env.DASH_VERIFY_HERMES_PROFILE ?? "clean";
if (!sessionId) throw new Error("Set DASH_VERIFY_HERMES_SESSION to the exact session to verify.");
const scratch = process.env.TMPDIR;
if (!scratch) throw new Error("TMPDIR must select private scratch storage.");
const credentials = mkdtempSync(join(scratch, "dash-hermes-proof-"));
const port = 4799;
const proc = Bun.spawn(["bun", "bridge/index.ts"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, DASH_HOST: "127.0.0.1", DASH_PORT: String(port), DASH_ALLOW_LOOPBACK: "1", DASH_CREDENTIAL_DIR: credentials, DASH_GATE_ENABLED: "0" }, stdout: "ignore", stderr: "ignore" });
let ws: WebSocket | undefined;
try {
  let token = "";
  for (let n = 0; n < 100; n++) {
    if (proc.exitCode !== null) throw new Error(`Isolated bridge exited ${proc.exitCode}`);
    try { token = readFileSync(join(credentials, "token"), "utf8").trim(); if (token && (await fetch(`http://127.0.0.1:${port}/roster`, { headers: { Authorization: `Bearer ${token}` } })).ok) break; } catch { /* startup */ }
    await Bun.sleep(100);
  }
  if (!token) throw new Error("Isolated bridge did not start");
  const url = `http://127.0.0.1:${port}/roster`;
  if ((await fetch(url)).status !== 401) throw new Error("Unauthenticated roster was not denied");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload: unknown = await response.json();
  const hosts = typeof payload === "object" && payload !== null && "hosts" in payload ? parseHosts(payload.hosts) : undefined;
  if (!hosts) throw new Error("Invalid bridge roster");
  const host = hosts.find(h => h.self);
  const owner = host?.agents.find(a => a.kind === "hermes" && a.profileId === profile && a.sessionId === sessionId);
  if (!owner || !host) throw new Error("Owner session missing from roster");
  const root = process.env.DASH_HERMES_ROOT ?? join(homedir(), ".hermes");
  const db = new Database(join(root, profile === "default" ? "" : `profiles/${profile}`, "state.db"), { readonly: true });
  const native = db.query<{ title: string }, [string]>("SELECT title FROM sessions WHERE id=?").get(sessionId);
  const latest = db.query<{ id: number }, [string]>("SELECT id FROM messages WHERE session_id=? AND active=1 AND role IN ('user','assistant') AND length(trim(coalesce(content,'')))>0 ORDER BY timestamp DESC,id DESC LIMIT 1").get(sessionId);
  db.close();
  if (owner.name !== native?.title) throw new Error("Roster title differs from native title");
  const conversations = mergeLiveConversations([{ id: "saved-omp", harness: "omp", title: "Previously paired OMP", sessionId: "no-longer-live", createdAt: 1, updatedAt: 1, messages: [] }], hosts, Date.now());
  if (!conversations.find(c => c.id === "saved-omp")?.stale || conversations.find(c => c.sessionId === sessionId)?.title !== native.title) throw new Error("Roster reconciliation failed");
  const inbox: ServerMessage[] = [];
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Authorization: `Bearer ${token}` } });
  ws.addEventListener("message", event => { const value = parseServerMessage(JSON.parse(String(event.data))); if (value) inbox.push(value); });
  for (let n = 0; n < 150 && !inbox.some(m => m.type === "hello"); n++) await Bun.sleep(100);
  const hello = inbox.find(m => m.type === "hello");
  if (hello?.type !== "hello" || !hello.hosts?.some(h => h.agents.some(a => a.id === owner.id))) throw new Error("WS hello lacks owner session");
  ws.send(JSON.stringify({ type: "history", harness: "hermes", sessionId, hostId: hello.host, profileId: owner.id }));
  for (let n = 0; n < 150 && !inbox.some(m => m.type === "history"); n++) await Bun.sleep(100);
  const history = inbox.find(m => m.type === "history");
  if (history?.type !== "history" || !history.messages.length || history.profileId !== owner.id) throw new Error("Scoped Hermes history missing");
  if (latest && !history.messages.some(m => m.id === String(latest.id))) throw new Error("History did not include latest native visible message");
  const summary = { isolatedPort: port, unauthenticatedRoster: 401, profile, sessionId, title: owner.name, sessions: hosts.flatMap(h => h.agents).filter(a => a.kind === "hermes" && a.sessionId).length,
    httpListed: true, wsListed: true, historyMessages: history.messages.length, latestNativeId: latest?.id, latestReturnedIds: history.messages.slice(-3).map(m => m.id), staleOmp: true, ownerSessionWritten: false };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  ws?.close();
  proc.kill("SIGTERM");
  const timer = setTimeout(() => proc.kill("SIGKILL"), 3000);
  await proc.exited;
  clearTimeout(timer);
  rmSync(credentials, { recursive: true, force: true });
}
