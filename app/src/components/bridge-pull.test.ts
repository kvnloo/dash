import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEL } from "../motion";
import {
  SHEET_DIM,
  SHEET_RUBBER,
  SHEET_SNAP,
  SHEET_VEL,
  backdropOpacity,
  clampPull,
  pullFromDrag,
  rubber,
  settlePull,
  sheetStretchY,
  sheetTranslateY,
} from "./bridge-pull";

describe("bridge pull physics", () => {
  test("drag maps 1:1 against sheet height", () => {
    expect(pullFromDrag(0, 140, 280)).toBeCloseTo(0.5);
    expect(pullFromDrag(1, -140, 280)).toBeCloseTo(0.5);
  });

  test("cannot pull the sheet above closed", () => {
    expect(pullFromDrag(0, -80, 280)).toBe(0);
    expect(clampPull(-2)).toBe(0);
  });

  test("rubber past open is less than the raw overscroll", () => {
    expect(rubber(1)).toBeGreaterThan(0);
    expect(rubber(1)).toBeLessThan(1);
    expect(sheetTranslateY(1.5, 280)).toBeGreaterThan(0);
    expect(sheetTranslateY(1.5, 280)).toBeLessThan(140);
  });

  test("closed sits one sheet height above rest, open sits at 0", () => {
    expect(sheetTranslateY(0, 280)).toBe(-280);
    expect(sheetTranslateY(1, 280)).toBe(0);
    expect(sheetStretchY(1)).toBe(1);
    expect(sheetStretchY(2)).toBeGreaterThan(1);
  });

  test("fling and distance both snap", () => {
    expect(settlePull(0.2, 0, 280)).toBe(0);
    expect(settlePull(0.7, 0, 280)).toBe(1);
    expect(settlePull(0.2, 900, 280)).toBe(1);
    expect(settlePull(0.8, -900, 280)).toBe(0);
  });

  test("backdrop fades with progress and caps at SHEET_DIM", () => {
    expect(SHEET_RUBBER).toBe(0.34);
    expect(SHEET_SNAP).toBe(0.36);
    expect(SHEET_VEL).toBe(0.2);
    expect(SHEET_DIM).toBe(0.46);
    expect(backdropOpacity(0)).toBe(0);
    expect(backdropOpacity(1)).toBe(SHEET_DIM);
    expect(backdropOpacity(2)).toBe(SHEET_DIM);
    expect(SHEET_SNAP).toBeLessThan(0.5);
  });
});

describe("bridge pull wiring", () => {
  test("overlay is a Reanimated gel sheet, not a Modal", () => {
    const src = readFileSync(join(import.meta.dir, "BridgePull.tsx"), "utf8");
    expect(src).toContain("Gesture.Pan");
    expect(src).toContain("withSpring");
    expect(src).toContain("sheetTranslateY");
    expect(src).toContain("ReduceMotion.System");
    expect(src).toContain("...GEL");
    expect(src).not.toContain("Modal");
    expect(src).not.toContain('Animated } from "react-native"');
    expect(src).not.toMatch(/height:\s*progress/);
  });

  test("App mounts the overlay once under GestureHandlerRootView", () => {
    const app = readFileSync(join(import.meta.dir, "../../App.tsx"), "utf8");
    expect(app).toContain("BridgePullProvider");
    expect(app).toContain("BridgePullOverlay");
    expect(app).toContain("GestureHandlerRootView");
  });

  test("down chevron and nav pan toggle the overlay instead of pushing Settings", () => {
    const nav = readFileSync(join(import.meta.dir, "AppNav.tsx"), "utf8");
    const web = readFileSync(join(import.meta.dir, "AppNav.web.tsx"), "utf8");
    expect(nav).toContain("useBridgePullPan");
    expect(nav).toContain("pull.toggle()");
    expect(nav).toContain("Bridge details");
    expect(nav).toContain("rotateZ");
    expect(web).toContain("pull.toggle()");
    expect(web).toContain("Bridge details");
    expect(nav).toContain("navigate(\"Voice\")");
  });

  test("does not invent a third spring", () => {
    const src = readFileSync(join(import.meta.dir, "BridgePull.tsx"), "utf8");
    expect(src).toContain("GEL");
    expect(src).not.toContain("stiffness: 180");
    expect(GEL.stiffness).toBe(240);
  });
});
