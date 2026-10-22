import { describe, expect, test } from "bun:test";
import { ACCESSORIES, DOT_PATTERNS, EYE_STYLES, chatBotIdentity, faceDots, faceExpression, faceSignature, hash32, hermesBotIdentity, harnessBotIdentity, mixHex } from "./bot-identity";
import type { OrbPhase } from "./orb-phase";

const GROOT = ["default", "chiefstaff", "clean", "intake", "jev-cu-bench", "jev-provider-bench", "loo", "memory-lab", "rippletern", "telegram"];

describe("bot identity", () => {
  test("the three owner bots keep their faces (changing these re-faces every bot)", () => {
    expect(faceSignature(hermesBotIdentity("default").face)).toBe("grid/single/antenna/sky");
    expect(faceSignature(hermesBotIdentity("chiefstaff").face)).toBe("fibonacci/round/ears/ink");
    expect(faceSignature(hermesBotIdentity("clean").face)).toBe("rings/tall/satellite/teal");
  });

  test("identities are stable: same profile, same identity, every call", () => {
    for (const p of GROOT) expect(hermesBotIdentity(p)).toEqual(hermesBotIdentity(p));
    expect(hash32("clean")).toBe(hash32("clean"));
    expect(hash32("clean")).not.toBe(hash32("clean "));
  });

  test("default, chiefstaff and clean differ in every salient part", () => {
    const faces = ["default", "chiefstaff", "clean"].map(p => hermesBotIdentity(p).face);
    for (const key of ["pattern", "eyes", "accessory", "tint"] as const) expect(new Set(faces.map(f => f[key])).size).toBe(3);
  });

  test("every profile on groot reads as its own bot", () => {
    const sigs = GROOT.map(p => faceSignature(hermesBotIdentity(p).face));
    expect(new Set(sigs).size).toBe(GROOT.length);
  });

  test("names and keys come from the profile; descriptors are never invented", () => {
    expect(hermesBotIdentity("clean")).toMatchObject({ key: "hermes:clean", profile: "clean", name: "clean" });
    expect(hermesBotIdentity("clean").descriptor).toBeUndefined();
    expect(hermesBotIdentity("chiefstaff").descriptor).toBe("chief of staff");
    expect(hermesBotIdentity(undefined).key).toBe("hermes:default");
    expect(hermesBotIdentity("  ").key).toBe("hermes:default");
  });

  test("a chat's bot is its Hermes profile, else the harness", () => {
    expect(chatBotIdentity("hermes", "clean").key).toBe("hermes:clean");
    expect(chatBotIdentity("hermes").key).toBe("hermes:default");
    expect(chatBotIdentity(undefined).key).toBe("hermes:default");
    expect(chatBotIdentity("omp", "clean", "OMP")).toMatchObject({ key: "harness:omp", name: "OMP" });
    expect(harnessBotIdentity("omp").face).toEqual(chatBotIdentity("omp").face);
    expect(faceSignature(harnessBotIdentity("omp").face)).not.toBe(faceSignature(hermesBotIdentity("omp").face));
  });

  test("fields stay inside the curated sets and tints stay subtle", () => {
    for (const p of [...GROOT, "x", "a-very-long-profile-name-0123456789"]) {
      const f = hermesBotIdentity(p).face;
      expect(DOT_PATTERNS).toContain(f.pattern);
      expect(EYE_STYLES).toContain(f.eyes);
      expect(ACCESSORIES).toContain(f.accessory);
      expect([0.8, 1, 1.25]).toContain(f.density);
      expect([0.8, 1, 1.3]).toContain(f.spinRate);
      expect(f.dotColor).toMatch(/^#[0-9a-f]{6}$/);
      // Dots are ink with a trace of tint: no channel strays more than ~16% of the way.
      const ink = [0xec, 0xe8, 0xdf];
      const dot = [1, 3, 5].map(i => parseInt(f.dotColor.slice(i, i + 2), 16));
      dot.forEach((c, i) => expect(Math.abs(c - (ink[i] ?? 0))).toBeLessThan(40));
    }
  });

  test("mixHex blends and rejects malformed input", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#102030", 0.7)).toBe("#102030");
    expect(mixHex("nope", "#ffffff", 0.5)).toBe("nope");
  });
});

describe("face geometry and expression", () => {
  test("every pattern stays inside the head and is roughly the requested density", () => {
    for (const pattern of DOT_PATTERNS) {
      const dots = faceDots(pattern, 96, 26);
      expect(dots.length).toBeGreaterThan(60);
      expect(dots.length).toBeLessThan(140);
      for (const d of dots) {
        expect(Math.hypot(d.x - 32, d.y - 32)).toBeLessThanOrEqual(26.01);
        expect(d.opacity).toBeGreaterThan(0);
        expect(d.opacity).toBeLessThanOrEqual(0.9);
      }
    }
  });

  test("fibonacci matches the original orb's silhouette exactly", () => {
    const dots = faceDots("fibonacci", 32, 26);
    const i = 7, y = 1 - 2 * (i + 0.5) / 32, r = Math.sqrt(1 - y * y), a = i * 2.3999632297;
    expect(dots[i]?.x).toBeCloseTo(32 + Math.cos(a) * r * 26, 6);
    expect(dots[i]?.y).toBeCloseTo(32 + y * 26, 6);
  });

  test("each phase has its own expression; only speech moves the mouth", () => {
    const phases: OrbPhase[] = ["idle", "thinking", "tool", "streaming", "waiting-approval", "listening", "speaking", "connecting"];
    const looks = new Set(phases.filter(p => p !== "speaking").map(p => JSON.stringify(faceExpression(p))));
    expect(looks.size).toBe(phases.length - 1);
    expect(phases.filter(p => faceExpression(p).mouth)).toEqual(["streaming", "speaking"]);
    // Thinking looks up and away, tool work looks down, approval looks straight at you.
    expect(faceExpression("thinking").gy).toBeLessThan(0);
    expect(faceExpression("tool").gy).toBeGreaterThan(0);
    expect(faceExpression("waiting-approval")).toMatchObject({ gx: 0, gy: 0 });
    expect(faceExpression("waiting-approval").scale).toBeGreaterThan(1);
  });
});
