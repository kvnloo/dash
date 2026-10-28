import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  NEXT_ACTION_LATER_MS,
  cardModel,
  dispatchCardAction,
  formatActionTimeChip,
  type NextAction,
} from "./next-action-card";

const action: NextAction = {
  id: "approval:chat-1:request-1",
  kind: "approve",
  conversationId: "chat-1",
  title: "Review access request",
  detail: "A coding agent is waiting for a decision.",
  estimateSec: 120,
  why: "The agent cannot proceed until you inspect the request.",
};

describe("next action card model", () => {
  test("always exposes exactly five distinct, accessible controls", () => {
    const model = cardModel(action, { expandedWhy: false });
    expect(model.title).toBe(action.title);
    expect(model.detail).toBe(action.detail);
    expect(model.buttons.map((button) => button.label)).toEqual(["Do", "Later", "Skip", "Edit", "Why?"]);
    expect(model.buttons.map((button) => button.id)).toEqual(["do", "later", "skip", "edit", "why"]);
    const labels = model.buttons.map((button) => button.accessibilityLabel);
    expect(new Set(labels).size).toBe(5);
    for (const button of model.buttons) {
      expect(button.accessibilityLabel).toContain(action.title);
      expect(button.accessibilityHint.length).toBeGreaterThan(10);
    }
    expect(model.buttons.find((button) => button.id === "later")?.accessibilityLabel).toContain("one hour");
  });

  test("Why? is hidden by default and available only when expanded", () => {
    const collapsed = cardModel(action, { expandedWhy: false });
    const expanded = cardModel(action, { expandedWhy: true });
    expect(collapsed.whyText).toBeNull();
    expect(expanded.whyText).toBe(action.why);
    expect(collapsed.buttons.find((button) => button.id === "why")?.accessibilityLabel).toContain("Show");
    expect(expanded.buttons.find((button) => button.id === "why")?.accessibilityLabel).toContain("Hide");
    expect(collapsed.title).toBe(expanded.title);
    expect(collapsed.detail).toBe(expanded.detail);
  });

  test("formatting is human-readable at the 30/60/120 second boundaries", () => {
    expect(formatActionTimeChip(30)).toBe("~30 sec");
    expect(formatActionTimeChip(60)).toBe("~1 min");
    expect(formatActionTimeChip(120)).toBe("~2 min");
    expect(cardModel({ ...action, estimateSec: 30 }, { expandedWhy: false }).timeChip).toBe("~30 sec");
    expect(cardModel(action, { expandedWhy: false }).timeChip).toBe("~2 min");
    expect(formatActionTimeChip(Number.NaN)).toBe("Time varies");
    expect(formatActionTimeChip(0)).toBe("Time varies");
  });

  test("all five selector kinds keep their action text and do not mutate input", () => {
    for (const kind of ["approve", "retry-send", "read-reply", "unstick", "continue"] satisfies NextAction["kind"][]) {
      const item = { ...action, kind };
      const model = cardModel(item, { expandedWhy: true });
      expect(model.title).toBe(action.title);
      expect(model.whyText).toBe(action.why);
      expect(model.buttons).toHaveLength(5);
      expect(item.kind).toBe(kind);
    }
  });

  test("Do, Later, Skip and Edit invoke exactly their respective caller callback", () => {
    const calls: string[] = [];
    const handlers = {
      onDo: (chosen: NextAction) => { if (chosen === action) calls.push("do"); },
      onLater: (chosen: NextAction) => { if (chosen === action) calls.push("later"); },
      onSkip: (chosen: NextAction) => { if (chosen === action) calls.push("skip"); },
      onEdit: (chosen: NextAction) => { if (chosen === action) calls.push("edit"); },
    };
    dispatchCardAction("do", action, handlers);
    dispatchCardAction("later", action, handlers);
    dispatchCardAction("skip", action, handlers);
    dispatchCardAction("edit", action, handlers);
    expect(calls).toEqual(["do", "later", "skip", "edit"]);
    expect(NEXT_ACTION_LATER_MS).toBe(3_600_000);
  });
});

// Source contract only, NOT evidence of a rendered or native control.
// Hermes must perform TalkBack, dynamic-type, reduced-motion, and small-screen checks.
test("unmounted component keeps 44-dp targets and accessible Why? toggle without side effects", () => {
  const component = readFileSync(new URL("../components/NextActionCard.tsx", import.meta.url), "utf8");
  expect(component).toContain('testID="next-action-card"');
  expect(component).toContain('testID="next-action-why"');
  expect(component).toContain('accessibilityRole="button"');
  expect(component).toContain("accessibilityState=");
  expect(component).toContain("minHeight: controlMin");
  expect(component).toContain("minWidth: controlMin");
  expect(component).toContain("dispatchCardAction(id, action");
  expect(component).not.toContain("setTimeout");
  expect(component).not.toContain("Animated");
  expect(component).not.toContain("../store/app");
  expect(component).not.toContain("../net/bridge");
});
