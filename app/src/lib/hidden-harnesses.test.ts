import { expect, test } from "bun:test";
import { hiddenHarnessIds, visibleHarnesses } from "./hidden-harnesses";

const all = ["omp", "codex", "grok", "claude", "hermes", "pi", "fx"].map(id => ({ id, name: id, available: true }));

test("no hide list keeps every harness (dev builds)", () => {
  expect(visibleHarnesses(all, hiddenHarnessIds(undefined))).toBe(all);
  expect(visibleHarnesses(all, hiddenHarnessIds(""))).toBe(all);
});

test("the RC hide list removes those harnesses from every picker", () => {
  expect(visibleHarnesses(all, hiddenHarnessIds(" grok, PI ,fx,")).map(h => h.id)).toEqual(["omp", "codex", "claude", "hermes"]);
});
