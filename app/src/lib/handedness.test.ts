import { expect, test } from "bun:test";
import { parseHandedness, resolveHandedness, thumbLayout } from "./handedness";
import { parseSettings } from "../model";

test("old and malformed preferences default to Right; valid values survive hydration", () => {
  for (const value of [undefined, null, "LEFT", {}, 1, "right"]) expect(parseHandedness(value)).toBe("right");
  const legacy = { address: "fixture:4747", token: "", harness: "hermes" };
  expect(parseSettings(legacy)?.handedness).toBe("right");
  for (const handedness of ["left", "right", "auto"] satisfies import("./handedness").Handedness[]) {
    expect(parseSettings({ ...legacy, handedness })?.handedness).toBe(handedness);
  }
});

test("Auto uses only an explicit system signal; explicit choices override it", () => {
  expect(resolveHandedness("auto")).toBe("right");
  expect(resolveHandedness("auto", "left")).toBe("left");
  expect(resolveHandedness("auto", "right")).toBe("right");
  expect(resolveHandedness("right", "left")).toBe("right");
  expect(resolveHandedness("left", "right")).toBe("left");
});

test("placements and signed offsets mirror without text direction or transforms", () => {
  const right = thumbLayout("right"), left = thumbLayout("left");
  expect(right.side).toBe("right"); expect(left.side).toBe("left");
  expect(right.opposite).toBe("left"); expect(left.opposite).toBe("right");
  expect(right.isLeft).toBe(false); expect(left.isLeft).toBe(true);
  expect(right.edge(12)).toEqual({ right: 12, left: undefined });
  expect(left.edge(12)).toEqual({ left: 12, right: undefined });
  expect(right.railPadding(44)).toEqual({ paddingRight: 44, paddingLeft: 0 });
  expect(left.railPadding(44)).toEqual({ paddingLeft: 44, paddingRight: 0 });
  expect(right.row).toEqual({ flexDirection: "row" });
  expect(left.row).toEqual({ flexDirection: "row-reverse" });
  expect(right.align).toEqual({ alignSelf: "flex-end" });
  expect(left.align).toEqual({ alignSelf: "flex-start" });
  expect(right.offset(48)).toBe(48); expect(left.offset(48)).toBe(-48);
  expect(right.offset(-12)).toBe(-12); expect(left.offset(-12)).toBe(12);
});
