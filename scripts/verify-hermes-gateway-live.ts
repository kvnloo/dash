#!/usr/bin/env bun
/**
 * Live proof: Dash replies into a Hermes session that is OPEN in a gateway-hosted CLI/TUI
 * go into that live session through the owning gateway (no handoff wait), the reply
 * streams back to Dash, and the terminal shows the turn.
 *
 * Owns only a loopback bridge on 127.0.0.1:4799 with disposable credentials under TMPDIR.
 * The target sessions and their terminals are SCRATCH sessions the operator opened in a
 * private tmux socket; never the owner's live session.
 *
 *   TMPDIR=<scratch> HERMES_HOME=~/.hermes/profiles/clean \
 *   DASH_PROOF_TARGETS='[{"sessionId":"local-…","tmux":"dashproof","pane":"tui:cli","busy":true}]' \
 *   bun scripts/verify-hermes-gateway-live.ts
 *
 * Prints ids, states, counts and booleans only; never message bodies or tokens.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseServerMessage, type ServerMessage } from "../shared/protocol";

const scratch = process.env.TMPDIR;
if (!scratch) throw new Error("TMPDIR must select private scratch storage.");
const hermesHome = process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes");
const profile = hermesHome.split("/profiles/")[1]?.split("/")[0] ?? "default";
// busy: start a ~20 s turn in the terminal first, so Dash's send lands mid-turn (queued behind it).
// paints: false for the classic prompt_toolkit CLI, which renders only its own turns (an upstream
// gap); the TUI and Desktop paint every viewer's turn.
type Target = { sessionId: string; tmux: string; pane: string; busy?: boolean; paints?: boolean };
const targets = JSON.parse(process.env.DASH_PROOF_TARGETS ?? "[]") as Target[];
if (!Array.isArray(targets) || targets.length === 0) throw new Error("DASH_PROOF_TARGETS names no scratch session.");
const credentials = mkdtempSync(join(scratch, "dash-live-proof-"));
const port = 4799;
const proc = Bun.spawn(["bun", "bridge/index.ts"], {
  cwd: join(import.meta.dir, ".."),
  env: { ...process.env, HERMES_HOME: hermesHome, DASH_HOST: "127.0.0.1", DASH_PORT: String(port), DASH_ALLOW_LOOPBACK: "1", DASH_CREDENTIAL_DIR: credentials, DASH_GATE_ENABLED: "0" },
  stdout: "pipe", stderr: "pipe",
});
let bridgeLog = "";
void (async () => { for await (const chunk of proc.stdout) bridgeLog += new TextDecoder().decode(chunk); })();
void (async () => { for await (const chunk of proc.stderr) bridgeLog += new TextDecoder().decode(chunk); })();
let ws: WebSocket | undefined;
const receipt: Record<string, unknown> = { isolatedPort: port, hermesHome: hermesHome.replace(homedir(), "~"), profile };

function lastAssistantHas(sessionId: string, word: RegExp): { messages: number; lastAssistantHasWord: boolean } {
  const db = new Database(join(hermesHome, "state.db"), { readonly: true });
  try {
    const n = db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM messages WHERE session_id=?").get(sessionId)?.n ?? -1;
    const last = db.query<{ content: string | null }, [string]>("SELECT content FROM messages WHERE session_id=? AND role='assistant' ORDER BY id DESC LIMIT 1").get(sessionId);
    return { messages: n, lastAssistantHasWord: word.test(last?.content ?? "") };
  } finally { db.close(); }
}

async function keys(target: Target, ...args: string[]): Promise<void> {
  await Bun.spawn(["tmux", "-L", target.tmux, "send-keys", "-t", target.pane, ...args], { stdout: "ignore", stderr: "ignore" }).exited;
}

/** The TUI's newest assistant reply line (`│  text`), or undefined. */
function lastReply(text: string): string | undefined {
  const replies = text.split("\n").flatMap(line => { const m = /^\s*│\s+(\S.*?)\s*$/.exec(line); const reply = m?.[1]?.replace(/\s+[┃│]+$/, "").trim(); return reply ? [reply] : []; });
  return replies.at(-1);
}

async function pane(target: Target): Promise<string> {
  const child = Bun.spawn(["tmux", "-L", target.tmux, "capture-pane", "-p", "-J", "-S", "-", "-t", target.pane], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(child.stdout).text();
  await child.exited;
  return text;
}

function owner(sessionStart: number): { surface?: string; pid?: number } {
  try {
    const leases = JSON.parse(readFileSync(join(hermesHome, "runtime", "active_sessions.json"), "utf8")) as { entries?: { surface?: string; pid?: number; started_at?: number }[] };
    const hit = leases.entries?.find(e => typeof e.started_at === "number" && Math.abs(e.started_at - sessionStart) < 5);
    return hit ? { surface: hit.surface, pid: hit.pid } : {};
  } catch { return {}; }
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
  if (!inbox.some(m => m.type === "hello")) throw new Error("no hello");
  const socket = ws;
  const events = (id: string) => inbox.filter((m): m is Extract<ServerMessage, { id: string; seq: number }> => "id" in m && "seq" in m && m.id === id);

  const results: unknown[] = [];
  for (const [index, target] of targets.entries()) {
    const db = new Database(join(hermesHome, "state.db"), { readonly: true });
    const row = db.query<{ started_at: number; created_source: string | null }, [string]>("SELECT started_at, created_source FROM sessions WHERE id=?").get(target.sessionId);
    db.close();
    if (!row) throw new Error(`scratch session ${target.sessionId} not found`);
    const id = `live-proof-${index}`;
    if (target.paints !== false) {
      // The terminal's own turn first, so its newest reply is "ready" until Dash's turn lands.
      await keys(target, "-l", "reply with just ready");
      await Bun.sleep(800);
      await keys(target, "Enter");
      for (let n = 0; n < 60 && lastReply(await pane(target)) !== "ready"; n++) await Bun.sleep(500);
    }
    const before = lastAssistantHas(target.sessionId, /pong/i);
    const paneBefore = lastReply(await pane(target));
    if (target.busy) {
      // Typed literally, Enter separately (a same-burst Enter is swallowed by completion menus).
      await keys(target, "-l", "run the shell command 'sleep 20' with your terminal tool, then reply with just slept");
      await Bun.sleep(800);
      await keys(target, "Enter");
      await Bun.sleep(6_000);
    }
    const startedAt = Date.now();
    socket.send(JSON.stringify({ type: "chat", id, harness: "hermes", text: "reply with just pong", sessionId: target.sessionId, profileId: `hermes:session:${profile}:${target.sessionId}` }));
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline && !events(id).some(e => e.type === "done")) await Bun.sleep(250);
    const list = events(id);
    const text = list.flatMap(e => (e.type === "delta" ? [e.text] : [])).join("");
    const done = list.find(e => e.type === "done");
    const session = list.find(e => e.type === "session");
    await Bun.sleep(2_000);
    const paneAfter = lastReply(await pane(target));
    const after = lastAssistantHas(target.sessionId, /pong/i);
    results.push({
      sessionId: target.sessionId, createdSource: row.created_source, lease: owner(row.started_at), sentMidTurn: Boolean(target.busy),
      liveStatus: list.some(e => e.type === "status" && /sending into the live session/.test(e.text)),
      handoffQueued: list.some(e => e.type === "status" && e.handoff?.state === "queued"),
      transport: session?.type === "session" ? session.transport : undefined,
      sameSession: session?.type === "session" ? session.sessionId === target.sessionId : undefined,
      exitCode: done?.type === "done" ? done.exitCode : undefined, seconds: Math.round((Date.now() - startedAt) / 1000),
      bridgeReplyHasPong: /pong/i.test(text), bridgeReplyChars: text.length,
      // The scratch terminal's own replies ("ready", "slept") must not leak into Dash's turn.
      bridgeReplyHasForeignText: /ready|slept/i.test(text),
      transcriptMessages: [before.messages, after.messages], transcriptLastAssistantHasPong: after.lastAssistantHasWord,
      terminalNewestReply: [paneBefore === undefined ? null : /pong/i.test(paneBefore) ? "pong" : "other", paneAfter === undefined ? null : /pong/i.test(paneAfter) ? "pong" : "other"],
      terminalShowsTurn: paneBefore !== undefined && !/pong/i.test(paneBefore) && /^pong\.?$/i.test(paneAfter ?? ""), terminalExpectedToPaint: target.paints !== false,
      errors: list.flatMap(e => (e.type === "error" ? [e.message.slice(0, 160)] : [])),
    });
  }
  receipt.results = results;
  receipt.bridgeLog = bridgeLog.split("\n").filter(l => /hermes\.(live|handoff|path)|turn\.(start|end)/.test(l)).map(l => l.replace(/^.*?(\d\d:\d\d:\d\d)/, "$1"));
  receipt.ok = results.every(r => {
    const x = r as Record<string, unknown>;
    return x.exitCode === 0 && x.bridgeReplyHasPong && x.transcriptLastAssistantHasPong && (x.terminalShowsTurn || !x.terminalExpectedToPaint) && x.transport === "gateway" && !x.handoffQueued && !x.bridgeReplyHasForeignText;
  });
} finally {
  ws?.close();
  proc.kill("SIGTERM");
  const timer = setTimeout(() => proc.kill("SIGKILL"), 3000);
  await proc.exited;
  clearTimeout(timer);
  rmSync(credentials, { recursive: true, force: true });
  console.log(JSON.stringify(receipt, null, 2));
}
