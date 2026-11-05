#!/usr/bin/env bun
/**
 * Live proof that Dash's bridge uses z0bridge for Hermes listing, history and continue.
 * Owns only: a z0bridge on 127.0.0.1:4790, a Dash bridge on 127.0.0.1:4798, disposable
 * credentials under TMPDIR, and ONE new throwaway Hermes session ("z0bridge dash smoke <nonce>")
 * that it archives at the end. It never touches an existing session or the owner's bridge/Metro.
 *
 *   Z0BRIDGE_REPO=/path/to/z0bridge TMPDIR=/private/scratch bun scripts/verify-z0bridge-hermes.ts
 */
import { Database } from "bun:sqlite";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseHosts, parseServerMessage, type ServerMessage } from "../shared/protocol";

const repo = process.env.Z0BRIDGE_REPO;
const scratch = process.env.TMPDIR;
const profile = process.env.DASH_VERIFY_HERMES_PROFILE ?? "clean";
if (!repo || !scratch) throw new Error("Set Z0BRIDGE_REPO and TMPDIR (private scratch).");
const work = mkdtempSync(join(scratch, "dash-z0bridge-proof-"));
const credentials = join(work, "dash");
const z0token = join(work, "z0token");
writeFileSync(z0token, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"));
chmodSync(z0token, 0o600);
const Z0 = 4790, DASH = 4798;
const title = `z0bridge dash smoke ${crypto.randomUUID().slice(0, 8)}`;
const z0log: string[] = [];
const z0 = Bun.spawn(["bun", "src/cli.ts", "serve", "--port", String(Z0), "--token-file", z0token, "--log-level", "debug"], { cwd: repo, stdout: "ignore", stderr: "pipe", env: process.env });
void (async () => { for await (const chunk of z0.stderr) z0log.push(new TextDecoder().decode(chunk)); })();
const dash = Bun.spawn(["bun", "bridge/index.ts"], { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "ignore",
  env: { ...process.env, DASH_HOST: "127.0.0.1", DASH_PORT: String(DASH), DASH_ALLOW_LOOPBACK: "1", DASH_CREDENTIAL_DIR: credentials, DASH_GATE_ENABLED: "0",
    DASH_Z0BRIDGE_URL: `http://127.0.0.1:${Z0}`, DASH_Z0BRIDGE_TOKEN_FILE: z0token } });
const z0auth = { authorization: `Bearer ${readFileSync(z0token, "utf8").trim()}` };
let ws: WebSocket | undefined;
let sessionId = "";
const hermes = async (args: string[]) => {
  const proc = Bun.spawn(["hermes", "-p", profile, ...args], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
};
try {
  let token = "";
  for (let n = 0; n < 150; n++) {
    try {
      token = readFileSync(join(credentials, "token"), "utf8").trim();
      if (token && (await fetch(`http://127.0.0.1:${Z0}/v1/health`)).ok && (await fetch(`http://127.0.0.1:${DASH}/roster`, { headers: { Authorization: `Bearer ${token}` } })).ok) break;
    } catch { /* startup */ }
    await Bun.sleep(100);
  }
  const cwd = mkdtempSync(join(work, "cwd-"));
  const created = await fetch(`http://127.0.0.1:${Z0}/v1/sessions`, { method: "POST", headers: { ...z0auth, "content-type": "application/json" }, body: JSON.stringify({ harness: "hermes", profile, cwd, title }) });
  if (created.status !== 201) throw new Error(`z0bridge create failed: ${created.status}`);
  sessionId = ((await created.json()) as { id: string }).id;
  await Bun.sleep(4500); // let the roster's 4 s cache expire

  const roster: unknown = await (await fetch(`http://127.0.0.1:${DASH}/roster`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const hosts = typeof roster === "object" && roster !== null && "hosts" in roster ? parseHosts(roster.hosts) : undefined;
  const agent = hosts?.find(h => h.self)?.agents.find(a => a.kind === "hermes" && a.sessionId === sessionId);
  if (!agent) throw new Error("Throwaway session missing from Dash roster");

  const inbox: ServerMessage[] = [];
  ws = new WebSocket(`ws://127.0.0.1:${DASH}/ws?token=${encodeURIComponent(token)}`);
  ws.addEventListener("message", event => { const value = parseServerMessage(JSON.parse(String(event.data))); if (value) inbox.push(value); });
  for (let n = 0; n < 150 && !inbox.some(m => m.type === "hello"); n++) await Bun.sleep(100);
  const turnId = `proof-${crypto.randomUUID()}`;
  ws.send(JSON.stringify({ type: "chat", id: turnId, harness: "hermes", text: "reply with the word pong", sessionId, profileId: agent.id, cwd }));
  const doneOf = () => inbox.find(m => m.type === "done" && m.id === turnId);
  for (let n = 0; n < 1200 && !doneOf(); n++) await Bun.sleep(100);
  const events = inbox.filter(m => "id" in m && m.id === turnId);
  const reply = events.flatMap(m => m.type === "delta" ? [m.text] : []).join("");
  const session = events.find(m => m.type === "session");
  const done = doneOf();
  ws.send(JSON.stringify({ type: "history", harness: "hermes", sessionId, profileId: agent.id }));
  for (let n = 0; n < 100 && !inbox.some(m => m.type === "history"); n++) await Bun.sleep(100);
  const history = inbox.find(m => m.type === "history");
  const log = z0log.join("");
  const summary = {
    profile, sessionId, title, rosterListed: true, reply: reply.slice(0, 40),
    doneExitCode: done?.type === "done" ? done.exitCode : null,
    transport: session?.type === "session" ? session.transport : null,
    historyMessages: history?.type === "history" ? history.messages.length : null,
    z0bridgeServedList: log.includes('"path":"/v1/sessions","status":200'),
    z0bridgeServedTurn: log.includes('"event":"turn.start"') && log.includes(sessionId),
    z0bridgeServedHistory: log.includes(`/v1/sessions/hermes/${profile}/${sessionId}/messages`),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!reply.toLowerCase().includes("pong") || summary.doneExitCode !== 0 || summary.transport !== "z0bridge" || !summary.z0bridgeServedList || !summary.z0bridgeServedTurn) throw new Error("z0bridge proof failed");
} finally {
  ws?.close();
  for (const proc of [dash, z0]) proc.kill("SIGTERM");
  await Promise.race([Promise.all([dash.exited, z0.exited]), Bun.sleep(8000)]);
  for (const proc of [dash, z0]) if (proc.exitCode === null) proc.kill("SIGKILL");
  if (sessionId) {
    const home = profile === "default" ? join(homedir(), ".hermes") : join(homedir(), ".hermes", "profiles", profile);
    const ended = () => { const db = new Database(join(home, "state.db"), { readonly: true }); try { return db.query<{ e: number | null }, [string]>("SELECT ended_at e FROM sessions WHERE id=?").get(sessionId)?.e != null; } finally { db.close(); } };
    for (let n = 0; n < 40 && !ended(); n++) await Bun.sleep(500);
    const extra = ended() ? [] : ["--include-open"];
    const preview = await hermes(["sessions", "archive", "--title", title, ...extra, "--dry-run"]);
    if (/^1 session\(s\) match/m.test(preview) && preview.includes(sessionId)) {
      console.log(JSON.stringify({ archived: (await hermes(["sessions", "archive", "--title", title, ...extra, "--yes"])).trim().split("\n").at(-1) }));
    } else console.log(JSON.stringify({ archived: false, reason: "dry run did not match exactly the throwaway session" }));
  }
  rmSync(work, { recursive: true, force: true });
}
