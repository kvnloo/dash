import { describe, expect, test } from "bun:test";
import {
  breakNudge,
  nextBlock,
  type BreakNudgeInput,
  type BreakNudgeLevel,
  type BreakNudgePhase,
  type FocusBlockKind,
} from "./break-nudge";

const MINUTE = 60_000;
const START = 1_800_000_000_000;

function snapshot(
  atMinutes: number,
  nudgesThisBlock = 0,
  change: Partial<BreakNudgeInput> = {},
): BreakNudgeInput {
  const now = START + atMinutes * MINUTE;
  return {
    now,
    blockStartAt: START,
    lastBreakEndAt: null,
    lastActivityAt: now,
    blockKind: "standard",
    phase: "PEAK",
    nudgesThisBlock,
    ...change,
  };
}

describe("breakNudge focus-block timeline", () => {
  const kinds: FocusBlockKind[] = ["standard", "rested"];
  for (const blockKind of kinds) {
    const duration = blockKind === "rested" ? 180 : 90;
    const timeline: ReadonlyArray<{
      at: number;
      nudges: number;
      level: BreakNudgeLevel;
      due: number | null;
    }> = [
      { at: 0, nudges: 0, level: "none", due: duration },
      { at: duration - 1, nudges: 0, level: "none", due: duration },
      { at: duration, nudges: 0, level: "soft", due: duration },
      { at: duration + 14, nudges: 1, level: "none", due: duration + 15 },
      { at: duration + 15, nudges: 1, level: "firm", due: duration + 15 },
      { at: duration + 45, nudges: 2, level: "firm", due: duration + 45 },
      { at: duration + 75, nudges: 3, level: "none", due: null },
      { at: duration + 105, nudges: 3, level: "none", due: null },
    ];

    test(`${blockKind} timeline at 0, pre-soft, soft, pre-firm, firm, repeat and cap`, () => {
      for (const { at, nudges, level, due } of timeline) {
        const result = breakNudge(snapshot(at, nudges, { blockKind }));
        expect(result.level).toBe(level);
        expect(result.dueAt).toBe(due === null ? null : START + due * MINUTE);
        expect(result.reason).toContain(`${at} minutes elapsed`);
        expect(result.reason).toContain(`${duration}-minute ${blockKind} focus block`);
      }
    });

    test(`${blockKind} exact millisecond boundaries and no early repeats`, () => {
      const softAt = START + duration * MINUTE;
      const firmAt = softAt + 15 * MINUTE;
      const repeatAt = firmAt + 30 * MINUTE;

      expect(breakNudge(snapshot(0, 0, { blockKind, now: softAt - 1 })).level).toBe("none");
      expect(breakNudge(snapshot(duration, 0, { blockKind })).level).toBe("soft");
      expect(breakNudge(snapshot(duration, 1, { blockKind })).dueAt).toBe(firmAt);
      expect(breakNudge(snapshot(duration + 15, 1, { blockKind, now: firmAt - 1 })).level).toBe("none");
      expect(breakNudge(snapshot(duration + 15, 1, { blockKind })).level).toBe("firm");
      expect(breakNudge(snapshot(duration + 45, 2, { blockKind, now: repeatAt - 1 })).level).toBe("none");
      expect(breakNudge(snapshot(duration + 45, 2, { blockKind })).level).toBe("firm");
      expect(breakNudge(snapshot(duration + 105, 3, { blockKind })).dueAt).toBeNull();
      expect(breakNudge(snapshot(duration + 105, 100, { blockKind })).level).toBe("none");
    });
  }
});

describe("breakNudge break detection and resets", () => {
  test("nine idle minutes do not reset, ten idle minutes do", () => {
    const nine = breakNudge(snapshot(90, 0, { lastActivityAt: START + 81 * MINUTE }));
    expect(nine.level).toBe("soft");
    expect(nine.dueAt).toBe(START + 90 * MINUTE);

    const ten = breakNudge(snapshot(90, 0, { lastActivityAt: START + 80 * MINUTE }));
    expect(ten.level).toBe("none");
    expect(ten.dueAt).toBe(START + 180 * MINUTE);
    expect(ten.reason).toContain("0 minutes elapsed");
    expect(ten.reason).toContain("inactivity break reset");
  });

  test("exact idle threshold is inclusive to the millisecond", () => {
    const justBefore = breakNudge(snapshot(90, 0, { lastActivityAt: START + 80 * MINUTE + 1 }));
    const atThreshold = breakNudge(snapshot(90, 0, { lastActivityAt: START + 80 * MINUTE }));
    expect(justBefore.level).toBe("soft");
    expect(atThreshold.level).toBe("none");
  });

  test("explicit completed break after block start resets time and nudge count", () => {
    const restarted = breakNudge(snapshot(125, 3, {
      lastBreakEndAt: START + 110 * MINUTE,
    }));
    expect(restarted).toMatchObject({
      level: "none",
      dueAt: START + 200 * MINUTE,
    });
    expect(restarted.reason).toContain("15 minutes elapsed");
    expect(restarted.reason).toContain("explicit break reset");
    const resumedSoft = breakNudge(snapshot(200, 3, {
      lastBreakEndAt: START + 110 * MINUTE,
    }));
    expect(resumedSoft.level).toBe("soft");
    expect(resumedSoft.dueAt).toBe(START + 200 * MINUTE);
  });

  test("earlier, equal, or future break markers do not reset the block", () => {
    for (const lastBreakEndAt of [
      START - MINUTE,
      START,
      START + 91 * MINUTE,
    ]) {
      const result = breakNudge(snapshot(90, 0, { lastBreakEndAt }));
      expect(result.level).toBe("soft");
      expect(result.dueAt).toBe(START + 90 * MINUTE);
    }
  });

  test("idle break resets a rested block for a full 180 minutes", () => {
    const result = breakNudge(snapshot(185, 2, {
      blockKind: "rested",
      lastActivityAt: START + 175 * MINUTE,
    }));
    expect(result.level).toBe("none");
    expect(result.dueAt).toBe(START + 365 * MINUTE);
  });

  test("subsequent poll with the same numeric inputs is deterministic and never mutates the input", () => {
    const input = Object.freeze(snapshot(105, 1));
    const first = breakNudge(input);
    const second = breakNudge(input);
    expect(first).toEqual(second);
    expect(first).toEqual({
      level: "firm",
      dueAt: START + 105 * MINUTE,
      reason: "105 minutes elapsed in the 90-minute standard focus block; firm break nudge is due.",
    });
  });
});

describe("breakNudge suppression, limits and invalid inputs", () => {
  test("all quiet/disengaged/inertia phases suppress even overdue or reset nudges", () => {
    const phases: BreakNudgePhase[] = [
      "WIND_DOWN", "PRE_SLEEP", "SLEEP", "DISENGAGED", "INERTIA",
    ];
    for (const phase of phases) {
      const result = breakNudge(snapshot(200, 0, { phase }));
      expect(result.level).toBe("none");
      expect(result.dueAt).toBeNull();
      expect(result.reason).toContain(phase);
      expect(result.reason).toContain("200 minutes elapsed");
    }
  });

  test("active PEAK, DIP and SECOND phases can nudge", () => {
    const phases: BreakNudgePhase[] = ["PEAK", "DIP", "SECOND"];
    for (const phase of phases) {
      expect(breakNudge(snapshot(90, 0, { phase })).level).toBe("soft");
    }
  });

  test("three total emitted nudges cap the block, including late timestamps", () => {
    for (const minutes of [90, 105, 135, 165, 195, 1_000]) {
      const result = breakNudge(snapshot(minutes, 3));
      expect(result.level).toBe("none");
      expect(result.dueAt).toBeNull();
      expect(result.reason).toContain("maximum of 3 nudges");
    }
  });

  test("invalid timestamps and counts fail closed without a deadline", () => {
    const invalid: BreakNudgeInput[] = [
      snapshot(90, -1),
      snapshot(90, 0.5),
      snapshot(90, Number.NaN),
      snapshot(90, 0, { now: Infinity }),
      snapshot(90, 0, { blockStartAt: Number.NaN }),
      snapshot(90, 0, { lastBreakEndAt: Infinity }),
      snapshot(90, 0, { lastActivityAt: Number.NaN }),
    ];
    for (const input of invalid) {
      const result = breakNudge(input);
      expect(result.level).toBe("none");
      expect(result.dueAt).toBeNull();
      expect(result.reason).toContain("0 minutes elapsed");
    }
  });
});

describe("nextBlock first rested morning window", () => {
  test("only the first 180 minutes after a rested wake get a rested block", () => {
    const wakeAt = START;
    for (const now of [wakeAt, wakeAt + MINUTE, wakeAt + 179 * MINUTE]) {
      expect(nextBlock({ now, wakeAt, restedMorning: true })).toBe("rested");
    }
    for (const now of [wakeAt - 1, wakeAt + 180 * MINUTE, wakeAt + 360 * MINUTE]) {
      expect(nextBlock({ now, wakeAt, restedMorning: true })).toBe("standard");
    }
  });

  test("non-rested mornings and invalid wake times use standard blocks", () => {
    expect(nextBlock({ now: START, wakeAt: START, restedMorning: false })).toBe("standard");
    expect(nextBlock({ now: START, wakeAt: Infinity, restedMorning: true })).toBe("standard");
    expect(nextBlock({ now: Number.NaN, wakeAt: START, restedMorning: true })).toBe("standard");
  });
});
