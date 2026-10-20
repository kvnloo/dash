import { describe, expect, test } from "bun:test";
import { threadAppearance } from "./thread-appearance";
import { colors, controlMin, fonts, glass, radius, timing, type } from "../theme";
import { orbHtml, presetForHarness } from "./orb-html";
describe("Living Night contract", () => {
 test("stale wins over live evidence and absent fields default false", () => {
  expect(threadAppearance({})).toEqual({ stale: false, live: false, label: undefined });
  expect(threadAppearance({ stale: true, live: true })).toEqual({ stale: true, live: false, label: "ended" });
  expect(threadAppearance({ live: true }).live).toBe(true);
 });
 test("ports the pinned sRGB tokens and type scale", () => {
  expect(colors.bg).toBe("#0c0c0a"); expect(colors.gold).toBe("#d7b986"); expect(colors.actionStrong).toBe("#eccd8c");
  expect(glass.fill).toBe("rgba(24,26,23,.46)"); expect(radius.md).toBe(14); expect(radius.lg).toBe(18);
  expect(type.title.fontFamily).toBe(fonts.editorial); expect(type.title.fontSize).toBe(30); expect(type.number.fontSize).toBe(34);
  expect(type.body.lineHeight).toBe(24); expect(type.mono.fontSize).toBe(12); expect(controlMin).toBe(44); expect(timing.transition).toBe(560);
 });
 test("harness defaults come from the source catalog", () => {
  expect(presetForHarness("hermes")).toBe("chatgpt"); expect(presetForHarness("grok")).toBe("grok"); expect(presetForHarness("omp")).toBe("elevenlabs");
 });
 test("idle orb is still and never samples fake microphone activity", () => {
  const html = orbHtml("chatgpt"); expect(html).toContain('data-phase="idle"'); expect(html).toContain("animation:none!important"); expect(html).not.toContain("getUserMedia");
  const official = orbHtml("elevenlabs", "idle"); expect(official).toContain("PHASE!=="); expect(official).toContain("WebGL2"); expect(official).not.toContain("Math.random");
 });
 test("all catalog appearances and Proof Mono have an explicit renderer", () => {
  for (const preset of ["chatgpt", "gemini", "siri", "alexa", "elevenlabs", "grok"] as const) expect(orbHtml(preset, "idle", true)).toContain("filter:grayscale(1)");
 });
});
