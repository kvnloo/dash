import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("verified-oss-loop onboard (Dash)", () => {
  test("rollout scheme is rolling with preview/nightly channels", () => {
    const yml = read(".verified-oss-loop/rollout.yml");
    expect(yml).toContain("schema: verified-oss-loop.rollout.v1");
    expect(yml).toContain("scheme: rolling");
    const show = Bun.spawnSync(["python3", ".verified-oss-loop/rollout.py", "show"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(show.exitCode).toBe(0);
    const out = show.stdout.toString();
    expect(out).toContain("worker_base=nightly");
    expect(out).toContain("feature_target=preview");
    expect(out).toContain("overnight_target=nightly");
  });

  test("AGENTS.md keeps Dash mutator and points at the loop", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("never merge `main`");
    expect(agents).toContain(".verified-oss-loop/rollout.py");
    expect(agents).toContain("bun scripts/mutate.ts");
    expect(agents).toContain("bun test app/src bridge/src shared");
    expect(agents).toContain(".cursor/skills/verify-dash");
    expect(agents.includes("bunx stryker")).toBe(false);
  });

  test("CI caches bun, freezes lockfiles, skips Playwright browsers, covers channels", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("preview");
    expect(ci).toContain("nightly");
    expect(ci).toContain("cache: true");
    expect(ci).toContain("--frozen-lockfile");
    expect(ci).toContain("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD");
    expect(ci).toContain("cancel-in-progress: true");
    expect(ci.includes("continue-on-error: true")).toBe(false);
    expect(ci).toContain("bun scripts/mutate.ts");
    expect(ci.includes("stryker")).toBe(false);
  });

  test("receipt check only gates preview and nightly", () => {
    const receipt = read(".github/workflows/receipt.yml");
    expect(receipt).toContain("preview");
    expect(receipt).toContain("nightly");
    expect(receipt.includes("branches: [main")).toBe(false);
    expect(existsSync(join(root, ".github/scripts/check-receipt.py"))).toBe(true);
  });

  test("channel automerge waits for checks and never targets main", () => {
    const preview = read(".github/workflows/automerge-preview.yml");
    const nightly = read(".github/workflows/automerge-nightly.yml");
    expect(preview).toContain("branches: [preview]");
    expect(nightly).toContain("branches: [nightly]");
    expect(preview).toContain("github.event.pull_request.head.sha");
    expect(nightly).toContain("github.event.pull_request.head.sha");
    expect(preview).toContain("--auto");
    expect(nightly).toContain("--auto");
    expect(preview.includes("branches: [main]")).toBe(false);
    expect(nightly.includes("branches: [main]")).toBe(false);
  });

  test("PR template binds an evidence receipt", () => {
    const tpl = read(".github/PULL_REQUEST_TEMPLATE.md");
    expect(tpl).toContain("head_revision");
    expect(tpl).toContain("base_revision");
    expect(tpl).toContain("tests:");
    expect(tpl).toContain("Workers never merge `main`/`dev`");
  });

  test("autodevelop day-pass PRs follow feature_target, not main", () => {
    const skill = read(".cursor/skills/autodevelop/SKILL.md");
    expect(skill).toContain("rollout.py");
    expect(skill).toContain("feature_target");
    expect(skill.includes("open a PR against `main`")).toBe(false);
    expect(skill.includes("If nothing is claimable: stop")).toBe(false);
    expect(skill).toContain("not labeled `claimed`");
  });

  test("kit skills do not replace Dash verify-dash or mutate.ts", () => {
    const tdd = read("skills/tdd/SKILL.md");
    const verify = read("skills/verify/SKILL.md");
    expect(tdd.includes("bunx stryker")).toBe(false);
    expect(verify).toContain("bun scripts/mutate.ts");
    expect(verify).toContain(".cursor/skills/verify-dash");
    expect(existsSync(join(root, ".cursor/skills/tdd/SKILL.md"))).toBe(true);
    expect(existsSync(join(root, ".cursor/skills/verify-dash/SKILL.md"))).toBe(true);
  });
});
