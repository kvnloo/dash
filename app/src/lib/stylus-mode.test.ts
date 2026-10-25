import { describe, expect, test } from "bun:test";
import { penButton, subscribeStylusButton, toggleMode } from "./stylus-mode";

describe("S Pen Annotate/Normal mode", () => {
  test("only a rising side-button edge toggles; release, contact and repeats do not", () => {
    let state = { active: false, buttonDown: false };
    expect(penButton(state, false)).toBe(state);
    state = penButton(state, true);
    expect(state).toEqual({ active: true, buttonDown: true });
    for (let i = 0; i < 100; i++) state = penButton(state, true);
    expect(state.active).toBe(true);
    state = penButton(state, false);
    expect(state).toEqual({ active: true, buttonDown: false });
    state = penButton(state, true);
    expect(state).toEqual({ active: false, buttonDown: true });
  });

  test("pill toggling is independent of hardware and does not reset the button latch", () => {
    const held = { active: true, buttonDown: true };
    expect(toggleMode(held)).toEqual({ active: false, buttonDown: true });
    expect(penButton(toggleMode(held), true).active).toBe(false);
    expect(toggleMode({ active: false, buttonDown: false }).active).toBe(true);
  });

  test("missing native module is a harmless no-op", () => {
    const observed: boolean[] = [];
    const stop = subscribeStylusButton(null, pressed => observed.push(pressed));
    expect(() => { stop(); stop(); }).not.toThrow();
    expect(observed).toEqual([]);
  });

  test("subscribes to button only, rejects malformed events and ignores late callbacks", () => {
    const observed: boolean[] = [];
    let listener: ((payload: unknown) => void) | undefined;
    let removals = 0;
    const stop = subscribeStylusButton({
      addListener(event, callback) {
        expect(event).toBe("button");
        listener = callback;
        return { remove: () => { removals++; } };
      },
    }, pressed => observed.push(pressed));
    listener?.({ pressed: true });
    listener?.({ pressed: "true" });
    listener?.({ pressed: 1 });
    listener?.(null);
    listener?.({ unrelated: true });
    listener?.({ pressed: false });
    stop();
    stop();
    listener?.({ pressed: true });
    expect(observed).toEqual([true, false, false]);
    expect(removals).toBe(1);
  });

  test("native listener failure leaves manual mode usable", () => {
    const stop = subscribeStylusButton({
      addListener() { throw new Error("native unavailable"); },
    }, () => { throw new Error("must not fire"); });
    expect(() => stop()).not.toThrow();
    expect(toggleMode({ active: false, buttonDown: false }).active).toBe(true);
  });
});
