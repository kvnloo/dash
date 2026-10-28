import { describe, expect, test } from "bun:test";
import { basename, dirname, join } from "node:path";
import { listFinishedSessions, type FsPort } from "./finished-sessions";

const HOME = "/home/reader";
const NOW = Date.UTC(2026, 9, 27, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

const CA = "00000000-0000-4000-8000-000000000001";
const CB = "00000000-0000-4000-8000-000000000002";
const CC = "00000000-0000-4000-8000-000000000003";
const LA = "11111111-1111-4111-8111-111111111111";
const LB = "22222222-2222-4222-8222-222222222222";

type FakeFile = { head: string; mtimeMs: number };

function fakeFs() {
  const dirs = new Map<string, Set<string>>();
  const files = new Map<string, FakeFile>();
  const deniedDirs = new Set<string>();
  const deniedFiles = new Set<string>();
  const reads: string[] = [];
  const readSizes: number[] = [];

  function addDir(path: string): void {
    if (dirs.has(path)) return;
    dirs.set(path, new Set());
    const parent = dirname(path);
    if (parent !== path) {
      addDir(parent);
      dirs.get(parent)?.add(basename(path));
    }
  }

  function addFile(path: string, head: string, mtimeMs: number): void {
    const parent = dirname(path);
    addDir(parent);
    dirs.get(parent)?.add(basename(path));
    files.set(path, { head, mtimeMs });
  }

  const fs: FsPort = {
    async readdir(path) {
      if (deniedDirs.has(path)) throw new Error("EACCES");
      const entries = dirs.get(path);
      if (!entries) throw new Error("ENOENT");
      // Deliberately not newest-first; the enumerator must order by mtime.
      return Array.from(entries).reverse();
    },
    async stat(path) {
      if (dirs.has(path)) return { mtimeMs: 0, isDirectory: true, size: 0 };
      const value = files.get(path);
      if (!value) throw new Error("ENOENT");
      return { mtimeMs: value.mtimeMs, isDirectory: false, size: Buffer.byteLength(value.head) };
    },
    async readHead(path, maxBytes) {
      reads.push(path);
      readSizes.push(maxBytes);
      if (deniedFiles.has(path)) throw new Error("EACCES");
      const value = files.get(path);
      if (!value) throw new Error("ENOENT");
      return value.head.slice(0, maxBytes);
    },
  };

  return {
    fs,
    addFile,
    denyDir(path: string) { deniedDirs.add(path); },
    denyFile(path: string) { deniedFiles.add(path); },
    reads,
    readSizes,
  };
}

function codexFile(day: string, time: string, id: string): string {
  return join(HOME, ".codex", "sessions", "2026", "10", day,
    "rollout-2026-10-" + day + "T" + time + "-" + id + ".jsonl");
}

function claudeFile(slug: string, id: string): string {
  return join(HOME, ".claude", "projects", slug, id + ".jsonl");
}

function codexHead(cwd: string, text?: string): string {
  const lines = [JSON.stringify({ type: "session_meta", payload: { cwd } })];
  if (text !== undefined) {
    lines.push(JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: text } }));
  }
  return lines.join("\n");
}

function claudeHead(cwd: string, text?: string): string {
  const lines = [JSON.stringify({ type: "file-history-snapshot", cwd })];
  if (text !== undefined) {
    lines.push(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }));
  }
  return lines.join("\n");
}

describe("finished local sessions", () => {
  test("enumerates three Codex rollouts and two Claude sessions with native ids and metadata", async () => {
    const disk = fakeFs();
    disk.addFile(codexFile("27", "10-00-00", CA), codexHead("/work/dash", "  Build  search\n parser "), NOW - 1000);
    disk.addFile(codexFile("26", "09-00-00", CB), codexHead("/work/db"), NOW - 3000);
    disk.addFile(codexFile("25", "08-00-00", CC), [
      JSON.stringify({ type: "session_meta", payload: { cwd: "/work/review", id: "must-not-override-filename" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Resume review" }] } }),
    ].join("\n"), NOW - 2000);
    disk.addFile(claudeFile("-work-client", LA), claudeHead("/work/client", " Fix   status\n badges "), NOW - 500);
    disk.addFile(claudeFile("-work-api", LB), claudeHead("/work/api"), NOW - 4000);

    const rows = await listFinishedSessions({ fs: disk.fs, homeDir: HOME, now: NOW });
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.id)).toEqual([
      "codex:session:" + CA,
      "codex:session:" + CC,
      "codex:session:" + CB,
      "claude:session:" + LA,
      "claude:session:" + LB,
    ]);
    expect(rows[0]).toEqual({
      id: "codex:session:" + CA,
      kind: "codex",
      name: "Build search parser",
      status: "available",
      sessionId: CA,
      cwd: "/work/dash",
      lastActivityAt: NOW - 1000,
      source: "local-store",
    });
    expect(rows[1]).toMatchObject({ name: "Resume review", sessionId: CC, cwd: "/work/review" });
    expect(rows[2]).toMatchObject({ name: "db", sessionId: CB, cwd: "/work/db" });
    expect(rows[3]).toMatchObject({
      id: "claude:session:" + LA,
      kind: "claude",
      name: "Fix status badges",
      status: "available",
      cwd: "/work/client",
      sessionId: LA,
      lastActivityAt: NOW - 500,
      source: "local-store",
    });
    expect(rows[4]).toMatchObject({ name: "api", cwd: "/work/api", sessionId: LB });
    expect(disk.readSizes).toEqual([65536, 65536, 65536, 65536, 65536]);
  });

  test("limit is per harness and stops reading as soon as newest valid rows fill it", async () => {
    const disk = fakeFs();
    disk.addFile(codexFile("26", "09-00-00", CA), codexHead("/work/old", "Old"), NOW - 4000);
    disk.addFile(codexFile("27", "10-00-00", CB), codexHead("/work/new", "Newest Codex"), NOW - 1000);
    disk.addFile(codexFile("25", "08-00-00", CC), codexHead("/work/older", "Older"), NOW - 5000);
    disk.addFile(claudeFile("a", LA), claudeHead("/work/claude", "Newest Claude"), NOW - 2000);
    disk.addFile(claudeFile("b", LB), claudeHead("/work/claude", "Older Claude"), NOW - 3000);

    const rows = await listFinishedSessions({ fs: disk.fs, homeDir: HOME, now: NOW, limitPerHarness: 1 });
    expect(rows.map((r) => r.id)).toEqual(["codex:session:" + CB, "claude:session:" + LA]);
    expect(disk.reads).toEqual([codexFile("27", "10-00-00", CB), claudeFile("a", LA)]);
  });

  test("age filter ignores stale files without opening them; zero limit does no work", async () => {
    const disk = fakeFs();
    disk.addFile(codexFile("27", "10-00-00", CA), codexHead("/work/new", "Recent"), NOW - 1000);
    disk.addFile(codexFile("26", "10-00-00", CB), codexHead("/work/boundary", "Boundary"), NOW - DAY_MS);
    disk.addFile(codexFile("25", "10-00-00", CC), codexHead("/work/stale", "Stale"), NOW - 3 * DAY_MS);
    disk.addFile(claudeFile("recent", LA), claudeHead("/work/c", "Claude"), NOW - 100);

    const rows = await listFinishedSessions({
      fs: disk.fs, homeDir: HOME, now: NOW, maxAgeDays: 1,
    });
    expect(rows.map((r) => r.sessionId)).toEqual([CA, CB, LA]);
    expect(disk.reads).not.toContain(codexFile("25", "10-00-00", CC));
    const count = disk.reads.length;
    expect(await listFinishedSessions({ fs: disk.fs, homeDir: HOME, now: NOW, limitPerHarness: 0 })).toEqual([]);
    expect(disk.reads).toHaveLength(count);
  });

  test("bad JSON, unreadable directories and files are ignored; missing cwd degrades safely", async () => {
    const disk = fakeFs();
    disk.addFile(codexFile("27", "10-00-00", CA), codexHead("/work/unreadable", "Hidden"), NOW - 100);
    disk.denyDir(join(HOME, ".codex", "sessions"));
    disk.addFile(claudeFile("ok", LA), [
      "{not-json}",
      JSON.stringify({ type: "user", message: { role: "user", content: "  Has title,\n no cwd " } }),
    ].join("\n"), NOW - 200);
    disk.addFile(claudeFile("bad", LB), "{invalid only}\n" + JSON.stringify({ type: "assistant", cwd: "", message: { content: "Assistant secret" } }), NOW - 300);
    const unreadable = claudeFile("read-denied", "33333333-3333-4333-8333-333333333333");
    disk.addFile(unreadable, claudeHead("/work/private", "Private transcript"), NOW - 400);
    disk.denyFile(unreadable);

    const rows = await listFinishedSessions({ fs: disk.fs, homeDir: HOME, now: NOW });
    expect(rows).toEqual([{
      id: "claude:session:" + LA,
      kind: "claude",
      name: "Has title, no cwd",
      status: "available",
      sessionId: LA,
      lastActivityAt: NOW - 200,
      source: "local-store",
    }]);
  });

  test("first user title is flattened and capped at 60 Unicode characters; never leaks later text", async () => {
    const disk = fakeFs();
    const privateTail = "DO-NOT-SHOW-TRANSCRIPT";
    const longText = ("🎯 alpha\tbeta\n".repeat(20)) + privateTail;
    disk.addFile(codexFile("27", "10-00-00", CA), [
      JSON.stringify({ type: "session_meta", payload: { cwd: "/work/project" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "Assistant-only content" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: longText } }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Later prompt that must not win" } }),
    ].join("\n"), NOW - 1000);

    const rows = await listFinishedSessions({ fs: disk.fs, homeDir: HOME, now: NOW });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.name).toBeDefined();
    expect(Array.from(row?.name ?? "")).toHaveLength(60);
    expect(row?.name.includes("\n")).toBe(false);
    expect(row?.name.includes("\t")).toBe(false);
    expect(JSON.stringify(row)).not.toContain(privateTail);
    expect(JSON.stringify(row)).not.toContain("Assistant-only");
    expect(JSON.stringify(row)).not.toContain("Later prompt");
  });

  test("duplicate Claude session ids across project folders keep the newest record", async () => {
    const disk = fakeFs();
    disk.addFile(claudeFile("a", LA), claudeHead("/work/old", "Old title"), NOW - 2000);
    disk.addFile(claudeFile("b", LA), claudeHead("/work/new", "New title"), NOW - 1000);
    const rows = await listFinishedSessions({ fs: disk.fs, homeDir: HOME, now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "claude:session:" + LA, name: "New title", cwd: "/work/new" });
    expect(disk.reads).toHaveLength(1);
  });
});
