import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function stringKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.keys(value);
}

function packageNames(pkg: unknown): Set<string> {
  if (typeof pkg !== "object" || pkg === null) return new Set();
  const deps = "dependencies" in pkg ? pkg.dependencies : undefined;
  const devDeps = "devDependencies" in pkg ? pkg.devDependencies : undefined;
  return new Set([...stringKeys(deps), ...stringKeys(devDeps)]);
}

function ignoreDirs(rel: string): string[] {
  const raw: unknown = JSON.parse(read(rel));
  if (typeof raw !== "object" || raw === null) return [];
  if (!("ignore_dirs" in raw)) return [];
  const dirs = raw.ignore_dirs;
  if (!Array.isArray(dirs)) return [];
  return dirs.filter((d): d is string => typeof d === "string");
}

describe("phone install surface", () => {
  const names = packageNames(JSON.parse(read("app/package.json")));

  test("phone package does not install unused native modules or Playwright browsers", () => {
    // Never imported. Metro haste-maps every file in node_modules, and
    // Playwright's postinstall pulls Chromium into `bun install --cwd app`.
    // punycode stays: app/metro.config.js still polyfills it (Kevin / UI).
    const dead = [
      "expo-av",
      "expo-camera",
      "expo-clipboard",
      "react-native-markdown-display",
      "@types/punycode",
      "playwright",
    ];
    for (const id of dead) {
      expect(names.has(id)).toBe(false);
    }
  });

  test("Markdown stays a Text node, not markdown-it", () => {
    const md = read("app/src/components/Markdown.tsx");
    expect(md).toContain("Plain-text renderer");
    expect(md).not.toContain("react-native-markdown-display");
    expect(md).not.toContain("markdown-it");
  });

  test("punycode stays a direct dep while metro.config.js polyfills it", () => {
    const metro = read("app/metro.config.js");
    if (metro.includes("punycode")) {
      expect(names.has("punycode")).toBe(true);
    }
  });

  test("watchman ignores worktrees and Expo build junk", () => {
    expect(existsSync(join(root, ".watchmanconfig"))).toBe(true);
    expect(existsSync(join(root, "app/.watchmanconfig"))).toBe(true);
    expect(ignoreDirs(".watchmanconfig")).toContain(".worktrees");
    expect(ignoreDirs("app/.watchmanconfig")).toContain(".expo");
  });

  test("debug screenshots do not put Playwright back in the phone app", () => {
    const shots = read("scripts/debug-screenshots.mjs");
    expect(shots.includes("cd app && bun add -d playwright")).toBe(false);
    expect(shots).toContain("bun add -d playwright");
  });

  test("CI unit job runs this file", () => {
    expect(read(".github/workflows/ci.yml")).toContain("scripts/phone-install.test.ts");
  });
});
