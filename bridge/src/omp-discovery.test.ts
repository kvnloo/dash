import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachOmpSessions, collectOmpSessions, liveOmpFromProcessRoot } from "./roster";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dash-omp-discovery-"));
  roots.push(root);
  const sessions = join(root, "home", ".omp", "agent", "sessions");
  const dir = join(sessions, "--mnt-zer0models--");
  mkdirSync(dir, { recursive: true });
  const sessionId = "01a16527-824c-7714-8205-9a2d0d5eff38";
  const file = join(dir, `2026-10-22T19-47-30-508Z_${sessionId}.jsonl`);
  writeFileSync(file, [
    JSON.stringify({ type: "title", v: 1, title: "HERMES: Improve Dash app session handling" }),
    JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-10-22T19:47:30.508Z", cwd: "/mnt/zer0models" }),
  ].join("\n"));
  return { root, sessions, dir, file, sessionId };
}

test("attaches the native id from the installed OMP double-dash cwd layout", () => {
  const f = fixture();
  expect(attachOmpSessions([{ id: "broker", cwd: "/mnt/zer0models" }], f.sessions, join(f.root, "home"))).toEqual([
    { id: "broker", cwd: "/mnt/zer0models", sessionId: f.sessionId, title: "HERMES: Improve Dash app session handling" },
  ]);
});

function frontend(root: string, pid: number, file: string, argv = ["omp"], pane = "43770011713541") {
  const proc = join(root, "proc", String(pid));
  mkdirSync(join(proc, "fd"), { recursive: true });
  writeFileSync(join(proc, "comm"), "omp\n");
  writeFileSync(join(proc, "cmdline"), argv.join("\0") + "\0");
  writeFileSync(join(proc, "environ"), `TERM_PROGRAM=tern\0TERN_PANE=${pane}\0`);
  symlinkSync("/mnt/zer0models", join(proc, "cwd"));
  symlinkSync(file, join(proc, "fd", "85"));
  return proc;
}

test("discovers the exact session held by the Tern frontend, not a newer transcript or subagent", () => {
  const f = fixture();
  const proc = frontend(f.root, 562919, f.file);
  const childDir = f.file.slice(0, -".jsonl".length);
  mkdirSync(childDir);
  const child = join(childDir, "OmpDashDetection.jsonl");
  writeFileSync(child, JSON.stringify({ type: "session", id: "OmpDashDetection" }));
  symlinkSync(child, join(proc, "fd", "80"));
  writeFileSync(join(f.dir, "2099_newer.jsonl"), JSON.stringify({ type: "session", id: "wrong-newer-session" }));
  // /proc resolves symlinked homes, while the bridge receives the user's home path.
  const alias = join(f.root, "session-alias");
  symlinkSync(f.sessions, alias);
  expect(liveOmpFromProcessRoot(join(f.root, "proc"), alias, pid => pid === 562919)).toEqual([
    { id: "tern-43770011713541", cwd: "/mnt/zer0models", sessionId: f.sessionId, title: "HERMES: Improve Dash app session handling" },
  ]);
});

test("separate frontends in the same cwd retain their own open session ids", () => {
  const f = fixture();
  frontend(f.root, 1, f.file, ["omp"], "11");
  const second = join(f.dir, "2099_second.jsonl");
  writeFileSync(second, JSON.stringify({ type: "session", id: "second-session" }));
  frontend(f.root, 2, second, ["omp"], "22");
  expect(liveOmpFromProcessRoot(join(f.root, "proc"), f.sessions, () => true).map(tab => tab.sessionId)).toEqual([
    f.sessionId, "second-session",
  ]);
});

test("excludes worker brokers, noninteractive modes, other programs, and dead processes", () => {
  const f = fixture();
  frontend(f.root, 1, f.file, ["omp", "__omp_worker_daemon_broker"]);
  frontend(f.root, 2, f.file, ["omp", "-p", "--mode", "json"]);
  frontend(f.root, 3, f.file, ["omp", "--mode=rpc"]);
  frontend(f.root, 4, f.file, ["omp", "--version"]);
  const other = frontend(f.root, 5, f.file);
  writeFileSync(join(other, "comm"), "hermes\n");
  frontend(f.root, 6, f.file);
  expect(liveOmpFromProcessRoot(join(f.root, "proc"), f.sessions, pid => pid !== 6)).toEqual([]);
});

test("an unreadable fd directory keeps a live frontend but never guesses another session", () => {
  const f = fixture();
  const proc = frontend(f.root, 1, f.file);
  rmSync(join(proc, "fd"), { recursive: true });
  rmSync(join(proc, "environ"));
  expect(liveOmpFromProcessRoot(join(f.root, "proc"), f.sessions, () => true)).toEqual([
    { id: "pid-1", cwd: "/mnt/zer0models", sessionId: "pid-1" },
  ]);
  expect(liveOmpFromProcessRoot(join(f.root, "absent"), f.sessions, () => true)).toEqual([]);
});

test("collects the frontend once instead of its shared cwd worker broker, retaining broker fallback elsewhere", () => {
  const f = fixture();
  frontend(f.root, 562919, f.file);
  const daemons = join(f.root, "home", ".omp", "run", "daemons");
  for (const [name, cwd] of [["shared", "/mnt/zer0models"], ["other", "/other"]]) {
    const dir = join(daemons, name!);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broker.sock"), "");
    writeFileSync(join(dir, "broker.pid"), JSON.stringify({ pid: 819811 }));
    writeFileSync(join(dir, "scope.json"), JSON.stringify({ projectDir: cwd }));
  }
  expect(collectOmpSessions(join(f.root, "home"), f.sessions, join(f.root, "proc"), () => true)).toEqual([
    { id: "tern-43770011713541", cwd: "/mnt/zer0models", sessionId: f.sessionId, title: "HERMES: Improve Dash app session handling" },
    { id: "other", cwd: "/other", sessionId: "other" },
  ]);
});
