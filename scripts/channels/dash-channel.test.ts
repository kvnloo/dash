import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const CLI = join(import.meta.dir, "dash-channel");
let root = "";
let origin = "";
let env: Record<string, string> = {};

function sh(cmd: string, cwd = root) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd}\n${r.stderr}`);
  return r.stdout.trim();
}

function run(...args: string[]) {
  return spawnSync(CLI, args, { encoding: "utf8", env: { ...process.env, ...env } });
}

function commit(msg: string, deps = "1") {
  writeFileSync(join(origin, "app/package.json"), JSON.stringify({ dependencies: { expo: deps } }));
  writeFileSync(join(origin, "app/note.txt"), msg);
  sh(`git add -A && git -c user.name=t -c user.email=t@t commit -qm ${JSON.stringify(msg)}`, origin);
  return sh("git rev-parse HEAD", origin);
}

beforeEach(() => {
  root = mkdtempSync(join(process.env.DASH_TEST_TMP ?? tmpdir(), "dash-channel-"));
  origin = join(root, "origin");
  mkdirSync(join(origin, "app"), { recursive: true });
  sh(`git init -q -b main ${origin}`);
  writeFileSync(join(origin, "app/app.json"), JSON.stringify({ expo: { android: { package: "x" } } }));
  writeFileSync(join(origin, "app/bun.lock"), "lock");
  const health = join(root, "healthy");
  writeFileSync(health, "1");
  // Stubs: systemctl logs restarts; install creates a fake expo cli; health reads a flag file.
  writeFileSync(join(root, "systemctl"), `#!/bin/sh\necho "$@" >> ${root}/systemctl.log\n`, { mode: 0o755 });
  env = {
    DASH_CHANNEL_CONF_DIR: join(root, "conf"),
    DASH_CHANNELS_HOME: join(root, "home"),
    DASH_RELEASES_DIR: join(root, "releases"),
    DASH_CHANNEL_REPO_URL: origin,
    DASH_CHANNEL_SYSTEMCTL: join(root, "systemctl"),
    DASH_CHANNEL_INSTALL_CMD: "sh -c 'mkdir -p node_modules/expo/bin && touch node_modules/expo/bin/cli && echo i >> ../../../installs.log'",
    DASH_CHANNEL_HEALTH_CMD: `test "$(cat ${health})" = 1`,
    DASH_CHANNEL_METRO_PORT: "1",
  };
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const active = () => basename(readlinkSync(join(env.DASH_CHANNELS_HOME, "active")));
const installs = () => (existsSync(join(root, "installs.log")) ? readFileSync(join(root, "installs.log"), "utf8").trim().split("\n").length : 0);

describe("dash-channel", () => {
  test("builds immutable releases and reuses node_modules for identical dependencies", () => {
    const a = commit("a");
    sh("git branch preview-x", origin);
    expect(run("init").status).toBe(0);
    expect(run("add", "stable", "main", "--pin").status).toBe(0);
    expect(run("add", "preview-x", "preview-x").status).toBe(0);
    expect(run("build", "--all").status).toBe(0);
    expect(existsSync(join(env.DASH_RELEASES_DIR, a, "app/note.txt"))).toBe(true);
    expect(installs()).toBe(1);
    const b = (sh("git checkout -q preview-x", origin), commit("b"));
    expect(run("build", "preview-x").status).toBe(0);
    expect(installs()).toBe(1); // same deps -> symlinked node_modules
    expect(readlinkSync(join(env.DASH_RELEASES_DIR, b, "app/node_modules"))).toContain(a);
    expect(run("list").stdout).toContain(a.slice(0, 12));
  });

  test("switch serves a channel, rollback returns to the previous one", () => {
    const a = commit("a");
    sh("git branch preview-x", origin);
    run("init");
    run("add", "stable", "main", "--pin");
    run("add", "preview-x", "preview-x");
    expect(run("switch", "stable").status).toBe(0);
    expect(active()).toBe(a);
    const b = (sh("git checkout -q preview-x", origin), commit("b"));
    expect(run("switch", "preview-x").status).toBe(0);
    expect(active()).toBe(b);
    expect(run("status", "--json").stdout).toContain('"channel":"preview-x"');
    expect(run("rollback").status).toBe(0);
    expect(active()).toBe(a);
    expect(readFileSync(join(root, "systemctl.log"), "utf8")).toContain("restart dash-channel-metro.service");
  });

  test("an unhealthy switch rolls back automatically", () => {
    const a = commit("a");
    sh("git branch preview-x", origin);
    run("init");
    run("add", "stable", "main", "--pin");
    run("add", "preview-x", "preview-x");
    run("switch", "stable");
    sh("git checkout -q preview-x", origin);
    commit("b");
    // Health fails once (for the preview), then passes (for the rollback).
    env.DASH_CHANNEL_HEALTH_CMD = `if [ -f ${root}/failed-once ]; then true; else touch ${root}/failed-once; false; fi`;
    const r = run("switch", "preview-x");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("rolled back to stable");
    expect(active()).toBe(a);
  });

  test("refuses a channel whose native dependencies differ from the dev client", () => {
    commit("a");
    sh("git branch preview-x", origin);
    run("init");
    run("add", "stable", "main", "--pin");
    run("add", "preview-x", "preview-x");
    run("switch", "stable");
    expect(run("baseline", "stable").status).toBe(0);
    sh("git checkout -q preview-x", origin);
    commit("b", "2");
    const r = run("switch", "preview-x");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("different native code");
    expect(run("switch", "preview-x", "--force").status).toBe(0);
  });

  test("a failed dependency install fails the build and leaves no release", () => {
    const a = commit("a");
    run("init");
    run("add", "main", "main");
    env.DASH_CHANNEL_INSTALL_CMD = "false";
    const r = run("build", "--all");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("dependency install failed");
    expect(existsSync(join(env.DASH_RELEASES_DIR, a))).toBe(false);
    expect(run("switch", "main").status).not.toBe(0);
  });

  test("nightly rebuilds track channels, re-serves the active one, leaves pins alone", () => {
    const a = commit("a");
    run("init");
    run("add", "stable", "main", "--pin");
    run("add", "nightly", "main");
    run("switch", "nightly");
    const b = commit("b");
    const r = run("nightly");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("re-served");
    expect(active()).toBe(b);
    run("build", "stable");
    expect(basename(readlinkSync(join(env.DASH_CHANNELS_HOME, "ch/stable")))).toBe(a);
    expect(run("promote", "nightly", "stable").status).toBe(0);
    expect(basename(readlinkSync(join(env.DASH_CHANNELS_HOME, "ch/stable")))).toBe(b);
  });
});
