import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  formatTurnIdle,
  parseTurnDiagnosis,
  stuckTurnView,
  type TurnAction,
  type TurnDiagnosis,
  type TurnState,
} from "./stuck-turn-view";

const actions: TurnAction[] = ["wait", "steer", "interrupt", "cancel", "open-host"];
const baseline: TurnDiagnosis = {
  state: "stuck",
  reason: "No new host events.",
  idleMs: 300_000,
  actions: ["wait", "steer", "interrupt"],
};

describe("bridge diagnosis parser", () => {
  test("accepts the sibling bridge contract and trims the reason without mutating the input", () => {
    const raw = {
      state: "stuck",
      reason: "  No new host events.  ",
      idleMs: 300_000,
      actions: ["wait", "steer", "interrupt", "cancel"],
    };
    expect(parseTurnDiagnosis(raw)).toEqual({ ...baseline, actions: [...actions.slice(0, 4)] });
    expect(raw.reason).toBe("  No new host events.  ");
  });

  test("rejects unknown state, non-array actions, NaN idleMs and other malformed responses", () => {
    const bad: unknown[] = [
      null, undefined, [], "stuck", 10,
      { ...baseline, state: "finished" },
      { ...baseline, state: null },
      { ...baseline, reason: "" },
      { ...baseline, reason: "  " },
      { ...baseline, reason: 22 },
      { ...baseline, idleMs: "300000" },
      { ...baseline, idleMs: Number.NaN },
      { ...baseline, idleMs: Number.POSITIVE_INFINITY },
      { ...baseline, idleMs: Number.NEGATIVE_INFINITY },
      { ...baseline, idleMs: -1 },
      { ...baseline, actions: "steer" },
      { ...baseline, actions: { 0: "steer" } },
      { ...baseline, actions: null },
      { ...baseline, actions: ["steer", "restart"] },
      { ...baseline, actions: ["steer", null] },
      { ...baseline, actions: ["steer", "steer"] },
      { state: "stuck", reason: "Missing idle and actions" },
    ];
    for (const raw of bad) expect(parseTurnDiagnosis(raw)).toBeNull();
  });

  test("accepts every allowed state and action, including an empty action list", () => {
    const states: TurnState[] = ["healthy", "slow", "stuck", "waiting-on-owner", "unobserved", "dead"];
    for (const state of states) {
      expect(parseTurnDiagnosis({ ...baseline, state, actions })).toEqual({ ...baseline, state, actions });
      expect(parseTurnDiagnosis({ ...baseline, state, actions: [] })?.actions).toEqual([]);
    }
  });
});

describe("stuck turn view", () => {
  test("healthy turn renders no banner", () => {
    expect(stuckTurnView({ ...baseline, state: "healthy" })).toBeNull();
  });

  const states: Array<{
    state: TurnState;
    title: string;
    tone: "quiet" | "warning";
    allowed: TurnAction[];
  }> = [
    { state: "slow", title: "Turn is taking longer", tone: "quiet", allowed: ["wait", "steer"] },
    { state: "stuck", title: "Turn may be stuck", tone: "warning", allowed: ["wait", "steer", "interrupt"] },
    { state: "waiting-on-owner", title: "Turn needs approval", tone: "warning", allowed: ["open-host"] },
    { state: "unobserved", title: "Turn status unavailable", tone: "quiet", allowed: [] },
    { state: "dead", title: "Turn process stopped", tone: "warning", allowed: ["open-host"] },
  ];

  for (const { state, title, tone, allowed } of states) {
    test(`${state} has the correct title, tone and only supplied actions`, () => {
      const view = stuckTurnView({ ...baseline, state, actions: allowed });
      expect(view?.title).toBe(title);
      expect(view?.tone).toBe(tone);
      expect(view?.detail).toContain(baseline.reason);
      expect(view?.actions.map((action) => action.id)).toEqual(allowed);
      expect(view?.actions.every((action) => !action.disabled)).toBe(true);
    });
  }

  test("action labels are explicit, accessible and preserve bridge order", () => {
    const view = stuckTurnView({ ...baseline, actions });
    expect(view?.actions.map((action) => action.label)).toEqual([
      "Wait", "Steer…", "Interrupt", "Cancel turn", "Open on host",
    ]);
    expect(view?.actions.map((action) => action.id)).toEqual(actions);
    expect(view?.actions.every((action) => action.accessibilityLabel.length > 10)).toBe(true);
  });

  test("no destructive cancel is invented; the bridge must explicitly offer it", () => {
    const readOnly = stuckTurnView({ ...baseline, state: "dead", actions: ["open-host"] });
    expect(readOnly?.actions.some((action) => action.id === "cancel")).toBe(false);
    const owned = stuckTurnView({ ...baseline, state: "dead", actions: ["cancel", "open-host"] });
    expect(owned?.actions.map((action) => action.id)).toEqual(["cancel", "open-host"]);
  });

  test("unobserved is always a quiet note with zero buttons even for a bad action inventory", () => {
    const view = stuckTurnView({ ...baseline, state: "unobserved", actions });
    expect(view?.tone).toBe("quiet");
    expect(view?.detail).toContain("cannot observe");
    expect(view?.detail).not.toContain("Idle");
    expect(view?.actions).toEqual([]);
  });

  test("any busyAction disables all controls and marks only the in-progress action", () => {
    const view = stuckTurnView({ ...baseline, actions }, { busyAction: "interrupt" });
    expect(view?.actions.every((action) => action.disabled)).toBe(true);
    expect(view?.actions.filter((action) => action.label.includes("Working…")).map((action) => action.id)).toEqual(["interrupt"]);
    expect(view?.actions.find((action) => action.id === "interrupt")?.accessibilityLabel).toContain("in progress");
    expect(view?.actions.find((action) => action.id === "cancel")?.label).toBe("Cancel turn");
    const unknownBusy = stuckTurnView({ ...baseline }, { busyAction: "request-pending" });
    expect(unknownBusy?.actions.every((action) => action.disabled)).toBe(true);
    const noBusy = stuckTurnView({ ...baseline });
    expect(noBusy?.actions.every((action) => !action.disabled)).toBe(true);
  });

  test("idle duration floors to seconds below a minute and whole minutes thereafter", () => {
    const cases = [
      { millis: 0, formatted: "0 s" },
      { millis: 999, formatted: "0 s" },
      { millis: 45_000, formatted: "45 s" },
      { millis: 59_000, formatted: "59 s" },
      { millis: 59_999, formatted: "59 s" },
      { millis: 60_000, formatted: "1 min" },
      { millis: 240_000, formatted: "4 min" },
      { millis: 3_599_000, formatted: "59 min" },
    ];
    for (const { millis, formatted } of cases) {
      expect(formatTurnIdle(millis)).toBe(formatted);
      expect(stuckTurnView({ ...baseline, state: "slow", idleMs: millis })?.detail).toContain(`Idle ${formatted}.`);
    }
  });
});

// Source-backed accessibility and geometry checks, not a rendered UI or device test.
test("unmounted component guards input, exposes accessible controls, and uses static 44-DIP targets", () => {
  const component = readFileSync(new URL("../components/StuckTurnBanner.tsx", import.meta.url), "utf8");
  expect(component).toContain("parseTurnDiagnosis(diagnosis)");
  expect(component).toContain("if (!parsed) return null");
  expect(component).toContain("if (!view) return null");
  expect(component).toContain('testID="stuck-turn-banner"');
  expect(component).toContain('parsed.state === "stuck" ? "alert" : "text"');
  expect(component).toContain('accessibilityLiveRegion={view.tone === "warning" ? "assertive" : "polite"}');
  expect(component).toContain('accessibilityRole="button"');
  expect(component).toContain("accessibilityLabel={action.accessibilityLabel}");
  expect(component).toContain("accessibilityState={{ disabled: action.disabled, busy: busyAction === action.id }}");
  expect(component).toContain("disabled={action.disabled}");
  expect(component).toContain("if (!action.disabled) onAction(action.id)");
  expect(component).toContain("minHeight: controlMin");
  expect(component).toContain("minWidth: controlMin");
  expect(component).not.toContain("Animated.");
  expect(component).not.toContain("reanimated");
  expect(component).not.toContain("../net/bridge");
  expect(component).not.toContain("../store/app");
});
