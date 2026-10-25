import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrateLiveConversation, mergeLiveConversations, shouldRequestHistory } from "../../app/src/lib/live-sessions";
import { HARNESSES } from "./harnesses";
import { assembleRoster, attachOmpSessions, findOmpJsonl, ompSessionDirName, readLiveTranscript } from "./roster";

const ID = "01J-DASH20-NATIVE";
const NOW = Date.parse("2026-10-25T10:30:00Z");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dash20-omp-"));
  roots.push(root);
  const home = join(root, "home");
  return { home, cwd: join(home, "workspace", "dash"), sessionRoot: join(root, "sessions") };
}
function session(f: ReturnType<typeof fixture>, cwd: string, answer: string, legacy = false): string {
  const folder = legacy ? ompSessionDirName(cwd, f.home) : `--${cwd.slice(1).split("/").join("-")}--`;
  const dir = join(f.sessionRoot, folder);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `2026-10-25T10-00-00Z_${ID}.jsonl`);
  writeFileSync(file, [
    JSON.stringify({ type: "session", id: ID, cwd }),
    JSON.stringify({ type: "message", id: "u1", timestamp: "2026-10-25T10:00:01Z", message: { role: "user", content: [{ type: "text", text: "continue this session" }] } }),
    JSON.stringify({ type: "message", id: "a1", timestamp: "2026-10-25T10:00:02Z", message: { role: "assistant", content: [{ type: "text", text: answer }] } }),
    "",
  ].join("\n"));
  return file;
}
function hosts(cwd: string, sessionId = ID) {
  return assembleRoster({ nodes: [], ompTabs: [{ id: "tern-42", cwd, sessionId }],
    harnesses: [{ id: "omp", name: "OMP", available: true }], selfFallback: { hostname: "paired" } });
}

test("#20: adopt native OMP tab, retain same session/cwd for history and --resume", () => {
  const f = fixture();
  session(f, f.cwd, "prior answer");
  const tabs = attachOmpSessions([{ id: "tern-42", cwd: f.cwd }], f.sessionRoot, f.home);
  expect(tabs[0]?.sessionId).toBe(ID);
  const roster = assembleRoster({ nodes: [], ompTabs: tabs,
    harnesses: [{ id: "omp", name: "OMP", available: true }], selfFallback: { hostname: "paired" } });
  const rows = mergeLiveConversations([], roster, NOW);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("No live chat");
  expect(row).toMatchObject({ id: `live:omp:${ID}`, harness: "omp", sessionId: ID,
    targetHostId: "paired", profileId: "omp:tern-42", cwd: f.cwd, stale: false, messages: [] });
  expect(mergeLiveConversations(rows, roster, NOW + 1)).toBe(rows);
  expect(shouldRequestHistory(row)).toBe(true);
  const history = readLiveTranscript("omp", ID, f.sessionRoot, row.cwd, f.home);
  expect(history.map(m => m.text)).toEqual(["continue this session", "prior answer"]);
  const hydrated = hydrateLiveConversation(row, history);
  expect(hydrated.messages.map(m => m.role)).toEqual(["user", "assistant"]);
  expect(hydrated.sessionId).toBe(ID);
  const omp = HARNESSES.find(h => h.id === "omp");
  if (!omp) throw new Error("OMP adapter missing");
  const argv = omp.argv({ text: "phone follow-up", cwd: hydrated.cwd ?? "", sessionId: hydrated.sessionId });
  expect(argv[argv.indexOf("--resume") + 1]).toBe(ID);
  expect(argv[argv.indexOf("--cwd") + 1]).toBe(f.cwd);
  expect(argv).toContain("phone follow-up");
});

test("#20: incomplete transcript does not hide an identified live OMP tab", () => {
  const f = fixture();
  const rows = mergeLiveConversations([], hosts(f.cwd), NOW);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.sessionId).toBe(ID);
  expect(rows[0]?.messages).toEqual([]);
  expect(shouldRequestHistory(rows[0])).toBe(true);
  expect(readLiveTranscript("omp", ID, f.sessionRoot, f.cwd, f.home)).toEqual([]);
});

test("#20: cwd-scoped history never falls back to a different project", () => {
  const f = fixture();
  const correct = session(f, f.cwd, "project A");
  const wrongCwd = join(f.home, "workspace", "other");
  expect(findOmpJsonl(f.sessionRoot, ID, f.cwd, f.home)).toBe(correct);
  expect(findOmpJsonl(f.sessionRoot, ID, wrongCwd, f.home)).toBeUndefined();
  expect(readLiveTranscript("omp", ID, f.sessionRoot, wrongCwd, f.home)).toEqual([]);
  // Unscoped legacy history requests retain backwards-compatible discovery.
  expect(readLiveTranscript("omp", ID, f.sessionRoot).at(-1)?.text).toBe("project A");
});

test("#20: duplicate native id in two cwd layouts stays scoped", () => {
  const f = fixture();
  const cwdB = join(f.home, "workspace", "other");
  const a = session(f, f.cwd, "project A");
  const b = session(f, cwdB, "project B", true);
  expect(findOmpJsonl(f.sessionRoot, ID, f.cwd, f.home)).toBe(a);
  expect(findOmpJsonl(f.sessionRoot, ID, cwdB, f.home)).toBe(b);
  expect(readLiveTranscript("omp", ID, f.sessionRoot, f.cwd, f.home).at(-1)?.text).toBe("project A");
  expect(readLiveTranscript("omp", ID, f.sessionRoot, cwdB, f.home).at(-1)?.text).toBe("project B");
  expect(readLiveTranscript("cursor-cloud", ID, f.sessionRoot, f.cwd, f.home)).toEqual([]);
  expect(readLiveTranscript("omp", "../bad", f.sessionRoot, f.cwd, f.home)).toEqual([]);
});

test("#20: foreign hosts and unknown harness ids fail closed", () => {
  const f = fixture();
  const paired = hosts(f.cwd)[0];
  if (!paired) throw new Error("Paired host missing");
  const rogue = { id: "cursor-cloud", name: "Cursor", kind: "cursor-cloud", status: "running" as const, sessionId: "foreign" };
  const rows = mergeLiveConversations([], [{ ...paired, agents: [...paired.agents, rogue] },
    { ...paired, id: "remote", self: false }], NOW);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.harness).toBe("omp");
  expect(mergeLiveConversations([], [{ ...paired, self: false }], NOW)).toEqual([]);
});
