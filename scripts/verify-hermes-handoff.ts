#!/usr/bin/env bun
/**
 * Live proof for replying into Hermes sessions from Dash, on a THROWAWAY session.
 *
 * Owns only: a loopback bridge on 127.0.0.1:4798 with disposable credentials under
 * TMPDIR, one new Hermes session it creates itself, and (optionally) one classic
 * Hermes CLI on that same throwaway session inside a private tmux socket.
 * Never touches the owner's bridge, Metro, pairing or existing Hermes sessions.
 * Prints ids, states, counts and booleans only; never message bodies or tokens.
 *
 *   TMPDIR=<scratch> HERMES_HOME=~/.hermes/profiles/clean bun scripts/verify-hermes-handoff.ts
 *   DASH_VERIFY_HANDOFF_CLI=0 skips the CLI-owned leg.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseHosts, parseServerMessage, type ServerMessage } from "../shared/protocol";

const scratch = process.env.TMPDIR;
if (!scratch) throw new Error("TMPDIR must select private scratch storage.");
const hermesHome = process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes");
const credentials = mkdtempSync(join(scratch, "dash-handoff-proof-"));
const port = 4798;
const tmuxSocket = `dash-handoff-proof-${process.pid}`;
const proc = Bun.spawn(["bun", "bridge/index.ts"], {
  cwd: join(import.meta.dir, ".."),
  env: { ...process.env, HERMES_HOME: hermesHome, DASH_HOST: "127.0.0.1", DASH_PORT: String(port), DASH_ALLOW_LOOPBACK: "1", DASH_CREDENTIAL_DIR: credentials, DASH_GATE_ENABLED: "0" },
  stdout: "ignore", stderr: "ignore",
});
let ws: WebSocket | undefined;
let cliStarted = false;
const receipt: Record<string, unknown> = { isolatedPort: port, hermesHome: hermesHome.replace(homedir(), "~"), ownerSessionsWritten: false };

function messageCount(sessionId: string): number {
  const db = new Database(join(hermesHome, "state.db"), { readonly: true });
  try { return db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM messages WHERE session_id=?").get(sessionId)?.n ?? -1; } finally { db.close(); }
}

async function tmux(...args: string[]): Promise<number> {
  const child = Bun.spawn(["tmux", "-L", tmuxSocket, ...args], { stdout: "ignore", stderr: "ignore" });
  return await child.exited;
}

try {
  let token = "";
  for (let n = 0; n < 150; n++) {
    if (proc.exitCode !== null) throw new Error(`Isolated bridge exited ${proc.exitCode}`);
    try { token = readFileSync(join(credentials, "token"), "utf8").trim(); if (token && (await fetch(`http://127.0.0.1:${port}/roster`, { headers: { Authorization: `Bearer ${token}` } })).ok) break; } catch { /* startup */ }
    await Bun.sleep(100);
  }
  if (!token) throw new Error("Isolated bridge did not start");
  const inbox: ServerMessage[] = [];
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  ws.addEventListener("message", event => { const value = parseServerMessage(JSON.parse(String(event.data))); if (value) inbox.push(value); });
  for (let n = 0; n < 150 && !inbox.some(m => m.type === "hello"); n++) await Bun.sleep(100);
  const hello = inbox.find(m => m.type === "hello");
  if (hello?.type !== "hello") throw new Error("no hello");
  const socket = ws;

  const events = (id: string) => inbox.filter((m): m is Extract<ServerMessage, { id: string; seq: number }> => "id" in m && "seq" in m && m.id === id);
  async function turn(id: string, body: Record<string, unknown>, waitMs = 180_000) {
    socket.send(JSON.stringify({ type: "chat", id, harness: "hermes", ...body }));
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && !events(id).some(e => e.type === "done")) await Bun.sleep(250);
    const list = events(id);
    const text = list.flatMap(e => (e.type === "delta" ? [e.text] : [])).join("");
    return { list, text, done: list.find(e => e.type === "done"), session: list.find(e => e.type === "session"), errors: list.flatMap(e => (e.type === "error" ? [e.message] : [])) };
  }

  // 1. New session from Dash (Hermes ACP). The throwaway session belongs to this proof.
  const first = await turn("proof-new", { text: "Dash reply proof (throwaway session). Reply with exactly the word ALPHA and nothing else." });
  const sessionId = first.session?.type === "session" ? first.session.sessionId : undefined;
  const profileId = first.session?.type === "session" ? first.session.profileId : undefined;
  receipt.newSession = { sessionId, profileId, transport: first.session?.type === "session" ? first.session.transport : undefined, exitCode: first.done?.type === "done" ? first.done.exitCode : undefined, replyHasAlpha: /ALPHA/.test(first.text), errors: first.errors };
  if (!sessionId || !profileId?.startsWith("hermes:session:") || first.done?.type !== "done" || first.done.exitCode !== 0) throw new Error(`new session failed: ${JSON.stringify(receipt.newSession)}`);

  // Roster lists it under the host profile, available, not held.
  const roster: unknown = await (await fetch(`http://127.0.0.1:${port}/roster`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const hosts = typeof roster === "object" && roster !== null && "hosts" in roster ? parseHosts(roster.hosts) : undefined;
  const listed = hosts?.flatMap(h => h.agents).find(a => a.id === profileId);
  receipt.rosterListed = { listed: Boolean(listed), status: listed?.status, openIn: listed?.openIn ?? null, source: listed?.source };
  if (!listed) throw new Error("new session missing from roster");

  // 2. Reply into the (non-CLI-owned) session.
  const second = await turn("proof-reply", { text: "Reply with exactly the word BRAVO and nothing else.", sessionId, profileId });
  receipt.reply = { sameSession: second.session?.type === "session" && second.session.sessionId === sessionId, transport: second.session?.type === "session" ? second.session.transport : undefined, exitCode: second.done?.type === "done" ? second.done.exitCode : undefined, replyHasBravo: /BRAVO/.test(second.text), errors: second.errors };
  if (second.done?.type !== "done" || second.done.exitCode !== 0 || !/BRAVO/.test(second.text)) throw new Error(`reply failed: ${JSON.stringify(receipt.reply)}`);

  // 3. CLI-owned: open the throwaway session in a real classic CLI, reply from Dash,
  //    prove nothing is written while it is open, then close the CLI and see delivery.
  if (process.env.DASH_VERIFY_HANDOFF_CLI !== "0") {
    const code = await tmux("new-session", "-d", "-x", "160", "-y", "40", "-s", "proof", `env HERMES_HOME=${hermesHome} hermes chat --resume ${sessionId}`);
    if (code !== 0) throw new Error("could not start the proof CLI");
    cliStarted = true;
    let held: string | undefined;
    for (let n = 0; n < 120 && !held; n++) {
      await Bun.sleep(500);
      const r: unknown = await (await fetch(`http://127.0.0.1:${port}/roster`, { headers: { Authorization: `Bearer ${token}` } })).json();
      const h = typeof r === "object" && r !== null && "hosts" in r ? parseHosts(r.hosts) : undefined;
      held = h?.flatMap(x => x.agents).find(a => a.id === profileId)?.openIn;
    }
    receipt.cliHeld = { openIn: held ?? null };
    if (!held) throw new Error("the proof CLI never took the session lease");
    const before = messageCount(sessionId);
    socket.send(JSON.stringify({ type: "chat", id: "proof-handoff", harness: "hermes", text: "Reply with exactly the word CHARLIE and nothing else.", sessionId, profileId }));
    for (let n = 0; n < 40 && !events("proof-handoff").some(e => e.type === "status" && e.handoff?.state === "queued"); n++) await Bun.sleep(250);
    const queued = events("proof-handoff").find(e => e.type === "status" && e.handoff?.state === "queued");
    await Bun.sleep(6_000);
    const during = messageCount(sessionId);
    const doneEarly = events("proof-handoff").some(e => e.type === "done");
    receipt.queued = { queuedStatus: queued?.type === "status" ? queued.text : null, messagesBefore: before, messagesWhileHeld: during, nothingWrittenWhileHeld: before === during, finishedWhileHeld: doneEarly };
    if (!queued || before !== during || doneEarly) throw new Error(`handoff did not queue: ${JSON.stringify(receipt.queued)}`);
    // Close the CLI the orderly way, the way the owner would.
    // Type the command literally, then Enter separately: the CLI's completion menu
    // swallows an Enter that arrives in the same burst as the text.
    await tmux("send-keys", "-t", "proof", "-l", "/exit");
    await Bun.sleep(1000);
    await tmux("send-keys", "-t", "proof", "Enter");
    for (let n = 0; n < 40 && (await tmux("has-session", "-t", "proof")) === 0; n++) await Bun.sleep(500);
    if ((await tmux("has-session", "-t", "proof")) === 0) { await tmux("send-keys", "-t", "proof", "C-d"); await Bun.sleep(3000); }
    cliStarted = (await tmux("has-session", "-t", "proof")) === 0;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline && !events("proof-handoff").some(e => e.type === "done")) await Bun.sleep(250);
    const all = events("proof-handoff");
    const text = all.flatMap(e => (e.type === "delta" ? [e.text] : [])).join("");
    const done = all.find(e => e.type === "done");
    receipt.handoff = { cliClosed: !cliStarted, sendingStatus: all.some(e => e.type === "status" && e.handoff?.state === "sending"), exitCode: done?.type === "done" ? done.exitCode : undefined, replyHasCharlie: /CHARLIE/.test(text), messagesAfter: messageCount(sessionId), errors: all.flatMap(e => (e.type === "error" ? [e.message] : [])) };
    if (done?.type !== "done" || done.exitCode !== 0 || !/CHARLIE/.test(text)) throw new Error(`handoff delivery failed: ${JSON.stringify(receipt.handoff)}`);
  }
  receipt.ok = true;
} finally {
  if (cliStarted) await tmux("kill-server");
  ws?.close();
  proc.kill("SIGTERM");
  const timer = setTimeout(() => proc.kill("SIGKILL"), 3000);
  await proc.exited;
  clearTimeout(timer);
  rmSync(credentials, { recursive: true, force: true });
  console.log(JSON.stringify(receipt, null, 2));
}
