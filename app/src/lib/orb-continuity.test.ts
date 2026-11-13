import { expect, test } from "bun:test";
import { orbAdvance, orbFrame, orbMotion, orbPulse, orbTarget, type OrbPhase } from "./orb-phase";

const phases: OrbPhase[] = ["idle", "thinking", "tool", "streaming", "waiting-approval", "listening", "speaking", "connecting"];

test("warning tint and rim are exclusive to approval; phase targets preserve geometry and opacity", () => {
  for (const phase of phases) {
    const m = orbMotion(phase);
    expect(orbTarget(phase)).toEqual({ spin: m.spin, base: m.base, amp: m.amp, beats: m.beats,
      abs: m.wave === "abs" ? 1 : 0, radiusX: m.radiusX, radiusY: m.radiusY, opacity: m.opacity,
      warning: phase === "waiting-approval" ? 1 : 0 });
  }
});

test("unwrapped motion crosses every former six-second seam without resetting", () => {
  for (const phase of phases) {
    const t = orbTarget(phase);
    for (const seam of [1, 2, 4, 1000]) {
      const before = orbAdvance(0, 0, seam - 0.000001, t.spin, t.beats);
      const after = orbAdvance(before.rotate, before.beat, 0.000002, t.spin, t.beats);
      expect(Math.abs(after.rotate - before.rotate)).toBeLessThan(0.002);
      expect(Math.abs(orbPulse(after.beat, t.base, t.amp, t.abs) - orbPulse(before.beat, t.base, t.amp, t.abs))).toBeLessThan(0.00001);
    }
  }
});

test("all phase pairs preserve angular position and pulse coordinate at the boundary, including interruptions", () => {
  for (const from of phases) for (const to of phases) {
    const a = orbTarget(from);
    const b = orbTarget(to);
    const pose = orbAdvance(17, 0.37, 0.43, a.spin, a.beats);
    expect(orbAdvance(pose.rotate, pose.beat, 0, b.spin, b.beats)).toEqual(pose);
    // A retarget starts from the current numeric parameters, not an endpoint or clock*new speed.
    for (const blend of [0, 0.15, 0.5, 1]) {
      const current = { base: a.base + (b.base - a.base) * blend, amp: a.amp + (b.amp - a.amp) * blend, abs: a.abs + (b.abs - a.abs) * blend };
      const scale = orbPulse(pose.beat, current.base, current.amp, current.abs);
      expect(Number.isFinite(scale)).toBe(true);
      expect(scale).toBeGreaterThan(0.8);
      expect(scale).toBeLessThan(1.1);
    }
  }
});

test("steady phase cadence matches original equations without a global loop reset", () => {
  for (const phase of phases) {
    const m = orbMotion(phase);
    const t = orbTarget(phase);
    for (const p of [0, 0.125, 0.73, 1, 1.01, 4.25]) {
      const pose = orbAdvance(0, 0, p, t.spin, t.beats);
      expect(pose.rotate).toBeCloseTo(orbFrame(m, p).rotate, 9);
      expect(orbPulse(pose.beat, t.base, t.amp, t.abs)).toBeCloseTo(orbFrame(m, p).scale, 9);
    }
  }
});

test("paused and reduced-motion samples do not move or catch up suspended time", () => {
  const pose = { rotate: 123, beat: 0.41 };
  for (const phase of phases) {
    const t = orbTarget(phase);
    expect(orbAdvance(pose.rotate, pose.beat, 0, t.spin, t.beats)).toEqual(pose);
  }
});
