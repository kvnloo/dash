import { expect, test } from "bun:test";
import { memoSelection, shallowArrayEqual } from "./createStore";

test("useSelector's selection keeps the last value while isEqual holds", () => {
  const select = memoSelection<{ items: number[] }, number[]>(shallowArrayEqual);
  const pick = (s: { items: number[] }) => s.items.filter(n => n > 1);
  const first = select({ items: [1, 2, 3] }, pick);
  expect(select({ items: [0, 2, 3] }, pick)).toBe(first);
  expect(select({ items: [2, 4] }, pick)).toEqual([2, 4]);
  const plain = memoSelection<number, string>();
  expect(plain(1, n => String(n))).toBe("1");
});
