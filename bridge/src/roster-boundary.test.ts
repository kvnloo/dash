import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleRoster, attachOmpSessions, liveOmpFromDaemonRoot, ompSessionDirName } from "./roster";

test("daemon tabs require a positive integral live PID even when the alive callback accepts input", () => {
  const root = mkdtempSync(join(tmpdir(), "dash-pid-boundary-"));
  for (const [index, pid] of [0, -1, 1.5, 4242].entries()) {
    const tab = join(root, String(index));
    mkdirSync(tab);
    writeFileSync(join(tab, "broker.sock"), "");
    writeFileSync(join(tab, "broker.pid"), JSON.stringify({ pid }));
    writeFileSync(join(tab, "scope.json"), JSON.stringify({ projectDir: "/project" }));
  }
  expect(liveOmpFromDaemonRoot(root, () => true)).toEqual([{ id: "3", cwd: "/project" }]);
  expect(liveOmpFromDaemonRoot(root, () => false)).toEqual([]);
});

test("session selection deterministically breaks equal-mtime ties by filename and ignores non-title rows", () => {
  const root = mkdtempSync(join(tmpdir(), "dash-session-boundary-"));
  const cwd = "/home/test/project";
  const dir = join(root, ompSessionDirName(cwd, "/home/test"));
  mkdirSync(dir);
  for (const name of ["a_old.jsonl", "z_new.jsonl"]) {
    const file = join(dir, name);
    writeFileSync(file, [
      JSON.stringify({ type: "session", id: name.startsWith("z") ? "new" : "old" }),
      JSON.stringify({ type: "title", title: "Real title" }),
      JSON.stringify({ type: "message", title: "Not a title" }),
      JSON.stringify({ type: "title", title: "   " }),
      JSON.stringify({ type: "title", title: 42 }),
    ].join("\n"));
    utimesSync(file, 1700000000, 1700000000);
  }
  expect(attachOmpSessions([{ id: "tab", cwd }], root, "/home/test")).toEqual([
    { id: "tab", cwd, sessionId: "new", title: "Real title" },
  ]);
});

test("an unknown daemon cwd stays undefined rather than being presented as a real directory", () => {
  const hosts = assembleRoster({ nodes: [], ompTabs: [{ id: "tab", cwd: "" }], harnesses: [], selfFallback: { hostname: "host" } });
  const agent = hosts.find(host => host.self)?.agents.find(agent => agent.id === "omp:tab");
  expect(agent?.detail).toBe("OMP tab");
  expect(agent?.cwd).toBeUndefined();
  expect(agent?.sessionId).toBe("tab");
});
