import { describe, expect, test } from "bun:test";
import {
  fingerRole,
  initialFlowMode,
  matchModeIntent,
  micPolicy,
  penRole,
  pillLabel,
  reduceFlowMode,
} from "./brainstorm-mode";
import type { FlowMode, FlowModeEvent, FlowModeState } from "./brainstorm-mode";

type Expected = readonly [mode: FlowMode, inkArmed: boolean, previous: FlowMode, buttonDown: boolean];
interface TransitionCase {
  event: FlowModeEvent;
  normal: Expected;
  annotate: Expected;
  brainstorm: Expected;
}

const transitions: readonly TransitionCase[] = [
  {
    event: { type: "pen-button", pressed: true },
    normal: ["annotate", false, "normal", true],
    annotate: ["normal", false, "annotate", true],
    brainstorm: ["brainstorm", false, "normal", true],
  },
  {
    event: { type: "pen-button", pressed: false },
    normal: ["normal", false, "normal", false],
    annotate: ["annotate", false, "normal", false],
    brainstorm: ["brainstorm", true, "normal", false],
  },
  {
    event: { type: "pill-tap" },
    normal: ["annotate", false, "normal", false],
    annotate: ["normal", false, "annotate", false],
    brainstorm: ["normal", false, "brainstorm", false],
  },
  {
    event: { type: "pill-long-press" },
    normal: ["brainstorm", true, "normal", false],
    annotate: ["brainstorm", true, "annotate", false],
    brainstorm: ["brainstorm", true, "normal", false],
  },
  {
    event: { type: "voice-intent", intent: "enter-brainstorm" },
    normal: ["brainstorm", true, "normal", false],
    annotate: ["brainstorm", true, "annotate", false],
    brainstorm: ["brainstorm", true, "normal", false],
  },
  {
    event: { type: "voice-intent", intent: "exit-brainstorm" },
    normal: ["normal", false, "normal", false],
    annotate: ["normal", false, "annotate", false],
    brainstorm: ["normal", false, "brainstorm", false],
  },
  {
    event: { type: "back" },
    normal: ["normal", false, "normal", false],
    annotate: ["normal", false, "annotate", false],
    brainstorm: ["normal", false, "brainstorm", false],
  },
  {
    event: { type: "cold-start" },
    normal: ["normal", false, "normal", false],
    annotate: ["normal", false, "normal", false],
    brainstorm: ["normal", false, "normal", false],
  },
];

function startAt(mode: FlowMode): FlowModeState {
  return {
    ...initialFlowMode(true),
    mode,
    inkArmed: mode === "brainstorm",
  };
}

describe("Flow mode pure reducer", () => {
  test("initializes in Normal even when Flow is enabled", () => {
    expect(initialFlowMode(true)).toEqual({
      mode: "normal", previous: "normal", inkArmed: false,
      buttonDown: false, flowEnabled: true,
    });
    expect(initialFlowMode(false)).toEqual({
      mode: "normal", previous: "normal", inkArmed: false,
      buttonDown: false, flowEnabled: false,
    });
  });

  test("all three modes x every event: exact state and no-op identity", () => {
    for (const row of transitions) {
      const modes: readonly FlowMode[] = ["normal", "annotate", "brainstorm"];
      const expected: readonly Expected[] = [row.normal, row.annotate, row.brainstorm];
      for (let index = 0; index < modes.length; index++) {
        const fromMode = modes[index];
        const fields = expected[index];
        if (!fromMode || !fields) throw new Error("incomplete mode transition table");
        const original = startAt(fromMode);
        const next = reduceFlowMode(original, row.event);
        const [mode, inkArmed, previous, buttonDown] = fields;
        expect(next).toEqual({ mode, inkArmed, previous, buttonDown, flowEnabled: true });
        const identical = mode === original.mode && inkArmed === original.inkArmed &&
          previous === original.previous && buttonDown === original.buttonDown;
        expect(next === original).toBe(identical);
        // A transition cannot mutate a shared state used by another subscriber.
        expect(original).toEqual(startAt(fromMode));
      }
    }
  });

  test("pen side button reacts once per rising edge, including while in Brainstorm", () => {
    let state = initialFlowMode(true);
    state = reduceFlowMode(state, { type: "pen-button", pressed: true });
    expect(state.mode).toBe("annotate");
    expect(reduceFlowMode(state, { type: "pen-button", pressed: true })).toBe(state);
    const tapped = reduceFlowMode(state, { type: "pill-tap" });
    expect(tapped.mode).toBe("normal");
    expect(tapped.buttonDown).toBe(true);
    expect(reduceFlowMode(tapped, { type: "pen-button", pressed: true })).toBe(tapped);
    const released = reduceFlowMode(tapped, { type: "pen-button", pressed: false });
    expect(released).not.toBe(tapped);
    expect(released.mode).toBe("normal");
    state = reduceFlowMode(released, { type: "pen-button", pressed: true });
    expect(state.mode).toBe("annotate");

    state = reduceFlowMode(state, { type: "pill-long-press" });
    expect(state).toMatchObject({ mode: "brainstorm", inkArmed: true, buttonDown: true });
    expect(reduceFlowMode(state, { type: "pen-button", pressed: true })).toBe(state);
    state = reduceFlowMode(state, { type: "pen-button", pressed: false });
    state = reduceFlowMode(state, { type: "pen-button", pressed: true });
    expect(state).toMatchObject({ mode: "brainstorm", inkArmed: false, buttonDown: true });
    expect(reduceFlowMode(state, { type: "pen-button", pressed: true })).toBe(state);
    state = reduceFlowMode(state, { type: "pen-button", pressed: false });
    state = reduceFlowMode(state, { type: "pen-button", pressed: true });
    expect(state).toMatchObject({ mode: "brainstorm", inkArmed: true, buttonDown: true });
  });

  test("Flow-disabled long press and voice entry preserve identical state", () => {
    const normal = initialFlowMode(false);
    expect(reduceFlowMode(normal, { type: "pill-long-press" })).toBe(normal);
    expect(reduceFlowMode(normal, { type: "voice-intent", intent: "enter-brainstorm" })).toBe(normal);
    expect(reduceFlowMode(normal, { type: "voice-intent", intent: "exit-brainstorm" })).toBe(normal);

    const annotate = reduceFlowMode(normal, { type: "pill-tap" });
    expect(annotate.mode).toBe("annotate");
    expect(reduceFlowMode(annotate, { type: "pill-long-press" })).toBe(annotate);
    expect(reduceFlowMode(annotate, { type: "voice-intent", intent: "enter-brainstorm" })).toBe(annotate);
    expect(reduceFlowMode(annotate, { type: "back" })).toMatchObject({ mode: "normal" });
  });

  test("long press or repeated entry rearms Brainstorm without replacing mode or previous", () => {
    let state = reduceFlowMode(startAt("annotate"), { type: "pill-long-press" });
    expect(state.previous).toBe("annotate");
    state = reduceFlowMode(state, { type: "pen-button", pressed: true });
    expect(state.inkArmed).toBe(false);
    const rearmed = reduceFlowMode(state, { type: "voice-intent", intent: "enter-brainstorm" });
    expect(rearmed).toMatchObject({ mode: "brainstorm", previous: "annotate", inkArmed: true, buttonDown: true });
    expect(reduceFlowMode(rearmed, { type: "pill-long-press" })).toBe(rearmed);
  });

  test("cold start discards ink, previous mode and stuck native button latch", () => {
    const held: FlowModeState = {
      mode: "brainstorm", previous: "annotate", inkArmed: true,
      buttonDown: true, flowEnabled: true,
    };
    const cold = reduceFlowMode(held, { type: "cold-start" });
    expect(cold).toEqual(initialFlowMode(true));
    expect(reduceFlowMode(cold, { type: "cold-start" })).toBe(cold);
    expect(reduceFlowMode(cold, { type: "pen-button", pressed: true }).mode).toBe("annotate");

    const normalWithHistory: FlowModeState = { ...initialFlowMode(false), previous: "brainstorm" };
    expect(reduceFlowMode(normalWithHistory, { type: "cold-start" })).toEqual(initialFlowMode(false));
  });

  test("derived pen, finger, mic and pill policies reflect visible mode and armed state", () => {
    const normal = startAt("normal");
    const annotate = startAt("annotate");
    const brainstorm = startAt("brainstorm");
    expect([micPolicy(normal), penRole(normal), fingerRole(normal), pillLabel(normal, true)])
      .toEqual(["per-session", "reply-select", "app", "Normal"]);
    expect([micPolicy(annotate), penRole(annotate), fingerRole(annotate), pillLabel(annotate, false)])
      .toEqual(["per-session", "ink", "scroll-pan", "Annotate"]);
    expect([micPolicy(brainstorm), penRole(brainstorm), fingerRole(brainstorm), pillLabel(brainstorm, true)])
      .toEqual(["continuous", "ink", "scroll-pan", "Brainstorm · ink · mic on"]);
    const pan = reduceFlowMode(brainstorm, { type: "pen-button", pressed: true });
    expect([micPolicy(pan), penRole(pan), fingerRole(pan), pillLabel(pan, false)])
      .toEqual(["continuous", "pan", "scroll-pan", "Brainstorm · pan · mic off"]);
  });
});

describe("Flow voice mode intent matching", () => {
  test("accepts explicit entry and exit commands regardless of case or punctuation", () => {
    const samples: readonly [string, "enter-brainstorm" | "exit-brainstorm"][] = [
      ["Let's brainstorm!", "enter-brainstorm"],
      ["lets brainstorm", "enter-brainstorm"],
      ["LET’S BRAINSTORM.", "enter-brainstorm"],
      ["Brainstorm mode?", "enter-brainstorm"],
      ["please start brainstorming.", "enter-brainstorm"],
      ["Stop brainstorming!", "exit-brainstorm"],
      ["EXIT: Brainstorm.", "exit-brainstorm"],
      ["end brainstorm", "exit-brainstorm"],
      ["could you exit brainstorm mode, please", "exit-brainstorm"],
    ];
    for (const [input, expected] of samples) {
      expect(matchModeIntent(input)).toBe(expected);
    }
  });

  test("ignores negated commands, even when they contain an otherwise valid trigger", () => {
    for (const phrase of [
      "don't brainstorm", "Don't start brainstorming!", "no brainstorm",
      "do not enter brainstorm mode", "NEVER start brainstorming",
      "let's not brainstorm", "I don't want to brainstorm",
      "don't stop brainstorming", "no, let's brainstorm",
    ]) expect(matchModeIntent(phrase)).toBeNull();
  });

  test("rejects partial words, mentions without commands, and empty input", () => {
    for (const phrase of [
      "", "  ", "brainstormed", "let's brain", "can we brainstorm",
      "this was a brainstorming session", "exitbrainstorm", "brainstorm modem",
      "stop brain", "time for lunch",
    ]) expect(matchModeIntent(phrase)).toBeNull();
  });
});
