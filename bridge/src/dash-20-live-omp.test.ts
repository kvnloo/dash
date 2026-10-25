import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESSES } from "./harnesses";
import { assembleRoster, attachOmpSessions, findOmpJsonl, ompSessionDirName, readLiveTranscript } from "./roster";

const ID = "01J-DASH20-NATIVE";
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
  expect(roster).toHaveLength(1);
  expect(roster[0]).toMatchObject({ id: "paired", self: true });
  const agent = roster[0]?.agents.find((candidate) => candidate.id === "omp:tern-42");
  if (!agent) throw new Error("Native OMP session missing from roster");
  expect(agent).toMatchObject({ kind: "omp", status: "running", sessionId: ID, cwd: f.cwd });
  const history = readLiveTranscript("omp", ID, f.sessionRoot, agent.cwd, f.home);
  expect(history.map((message) => ({ role: message.role, text: message.text }))).toEqual([
    { role: "user", text: "continue this session" },
    { role: "assistant", text: "prior answer" },
  ]);
  const omp = HARNESSES.find((h) => h.id === "omp");
  if (!omp) throw new Error("OMP adapter missing");
  const argv = omp.argv({ text: "phone follow-up", cwd: agent.cwd ?? f.cwd, sessionId: agent.sessionId });
  expect(argv[argv.indexOf("--resume") + 1]).toBe(ID);
  expect(argv[argv.indexOf("--cwd") + 1]).toBe(f.cwd);
  expect(argv).toContain("phone follow-up");
});

test("#20: incomplete transcript retains the native OMP session in the bridge roster", () => {
  const f = fixture();
  const roster = hosts(f.cwd);
  expect(roster).toHaveLength(1);
  expect(roster[0]?.agents[0]).toMatchObject({
    id: "omp:tern-42", kind: "omp", status: "running", sessionId: ID, cwd: f.cwd,
  });
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

