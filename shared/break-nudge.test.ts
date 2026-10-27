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
    lastNudgeAt: nudgesThisBlock === 0 ? null : Math.min(now, START + (nudgesThisBlock === 1 ? 90 : 105) * MINUTE),
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
        const lastNudgeAt = nudges === 0 ? null : START + (nudges === 1 ? duration : duration + 15) * MINUTE;
        const result = breakNudge(snapshot(at, nudges, { blockKind, lastNudgeAt }));
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

describe("actual delivery history regressions", () => {
  test("retained explicit break markers preserve new-block deliveries through the cap", () => {
    const lastBreakEndAt = START + 110 * MINUTE;
    for (const blockKind of ["standard", "rested"] satisfies FocusBlockKind[]) {
      const duration = blockKind === "rested" ? 180 : 90;
      const soft = 110 + duration;
      const base = { blockKind, lastBreakEndAt };
      expect(breakNudge(snapshot(soft, 3, base)).level).toBe("soft");
      const deliveredSoft = { ...base, lastNudgeAt: START + soft * MINUTE };
      expect(breakNudge(snapshot(soft + 1, 1, deliveredSoft))).toMatchObject({
        level: "none", dueAt: START + (soft + 15) * MINUTE,
      });
      expect(breakNudge(snapshot(soft + 15, 1, deliveredSoft)).level).toBe("firm");
      const deliveredFirm = { ...base, lastNudgeAt: START + (soft + 15) * MINUTE };
      expect(breakNudge(snapshot(soft + 45, 2, deliveredFirm)).level).toBe("firm");
      expect(breakNudge(snapshot(soft + 100, 3, {
        ...base, lastNudgeAt: START + (soft + 45) * MINUTE,
      }))).toMatchObject({ level: "none", dueAt: null });
    }
  });

  test("late firm delivery waits thirty actual minutes, inclusive to the millisecond", () => {
    const lastNudgeAt = START + 134 * MINUTE;
    for (const at of [134, 135, 163]) {
      expect(breakNudge(snapshot(at, 2, { lastNudgeAt }))).toMatchObject({
        level: "none", dueAt: START + 164 * MINUTE,
      });
    }
    expect(breakNudge(snapshot(164, 2, { lastNudgeAt, now: START + 164 * MINUTE - 1 })).level).toBe("none");
    expect(breakNudge(snapshot(164, 2, { lastNudgeAt })).level).toBe("firm");
  });

  test("late soft delivery cannot immediately catch up to the firm deadline", () => {
    const lastNudgeAt = START + 150 * MINUTE;
    expect(breakNudge(snapshot(150, 1, { lastNudgeAt }))).toMatchObject({
      level: "none", dueAt: START + 165 * MINUTE,
    });
    expect(breakNudge(snapshot(165, 1, { lastNudgeAt })).level).toBe("firm");
  });

  test("missing, stale, nonfinite and future delivery history fail closed", () => {
    for (const lastNudgeAt of [null, START - 1, Infinity, Number.NaN, START + 200 * MINUTE]) {
      expect(breakNudge(snapshot(135, 2, { lastNudgeAt }))).toMatchObject({ level: "none", dueAt: null });
    }
  });
});

describe("specified API without optional history", () => {
  // This exact shape is also a compile-time regression: do not fill in the
  // optional fields via snapshot(), or required-field API changes go unnoticed.
  function contractInput(at: number, nudgesThisBlock: number, blockKind: FocusBlockKind): BreakNudgeInput {
    const now = START + at * MINUTE;
    return {
      now, blockStartAt: START, lastBreakEndAt: null, lastActivityAt: now,
      blockKind, phase: "PEAK", nudgesThisBlock,
    };
  }

  test("contract-shaped calls follow both nominal timelines, not invalid-input fallback", () => {
    for (const blockKind of ["standard", "rested"] satisfies FocusBlockKind[]) {
      const duration = blockKind === "rested" ? 180 : 90;
      for (const [offset, count, level, due] of [
        [0, 0, "none", duration],
        [duration - 1, 0, "none", duration],
        [duration, 0, "soft", duration],
        [duration + 14, 1, "none", duration + 15],
        [duration + 15, 1, "firm", duration + 15],
        [duration + 45, 2, "firm", duration + 45],
        [duration + 75, 3, "none", null],
        [duration + 105, 3, "none", null],
      ] satisfies [number, number, BreakNudgeLevel, number | null][]) {
        const result = breakNudge(contractInput(offset, count, blockKind));
        expect(result).toMatchObject({ level, dueAt: due === null ? null : START + due * MINUTE });
        expect(result.reason).toContain(`${offset} minutes elapsed`);
      }
    }
  });

  test("contract-shaped idle reset and explicit-marker polls preserve current-block counts", () => {
    expect(breakNudge({ ...contractInput(90, 3, "standard"), lastActivityAt: START + 80 * MINUTE }))
      .toMatchObject({ level: "none", dueAt: START + 180 * MINUTE });
    for (const [at, count, level, due] of [
      [110, 0, "none", 200], [200, 0, "soft", 200],
      [201, 1, "none", 215], [215, 1, "firm", 215],
      [245, 2, "firm", 245], [275, 3, "none", null],
    ] satisfies [number, number, BreakNudgeLevel, number | null][]) {
      expect(breakNudge({ ...contractInput(at, count, "standard"), lastBreakEndAt: START + 110 * MINUTE }))
        .toMatchObject({ level, dueAt: due === null ? null : START + due * MINUTE });
    }
  });

  test("nextBlock accepts the three-field contract, including delayed first selection", () => {
    for (const now of [START, START + 360 * MINUTE]) {
      expect(nextBlock({ now, wakeAt: START, restedMorning: true })).toBe("rested");
      // Without completed history, the caller consumes first-block eligibility.
      expect(nextBlock({ now, wakeAt: START, restedMorning: false })).toBe("standard");
    }
    expect(nextBlock({ now: START - 1, wakeAt: START, restedMorning: true })).toBe("standard");
    expect(nextBlock({ now: START, wakeAt: Infinity, restedMorning: true })).toBe("standard");
  });
});

describe("nextBlock first actual rested morning block", () => {
  test("delayed first blocks are rested and early second blocks are standard", () => {
    const wakeAt = START;
    for (const now of [wakeAt, wakeAt + MINUTE, wakeAt + 179 * MINUTE, wakeAt + 360 * MINUTE]) {
      expect(nextBlock({ now, wakeAt, restedMorning: true, completedBlocksSinceWake: 0 })).toBe("rested");
      expect(nextBlock({ now, wakeAt, restedMorning: true, completedBlocksSinceWake: 1 })).toBe("standard");
    }
    for (const completedBlocksSinceWake of [-1, 0.5, Infinity, Number.NaN]) {
      expect(nextBlock({ now: wakeAt, wakeAt, restedMorning: true, completedBlocksSinceWake })).toBe("standard");
    }
  });

  test("non-rested mornings and invalid wake times use standard blocks", () => {
    expect(nextBlock({ now: START, wakeAt: START, restedMorning: false, completedBlocksSinceWake: 0 })).toBe("standard");
    expect(nextBlock({ now: START, wakeAt: Infinity, restedMorning: true, completedBlocksSinceWake: 0 })).toBe("standard");
    expect(nextBlock({ now: Number.NaN, wakeAt: START, restedMorning: true, completedBlocksSinceWake: 0 })).toBe("standard");
    expect(nextBlock({ now: START - 1, wakeAt: START, restedMorning: true, completedBlocksSinceWake: 0 })).toBe("standard");
  });
});
