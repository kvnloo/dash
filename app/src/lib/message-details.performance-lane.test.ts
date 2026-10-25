import { describe, expect, test } from "bun:test";
import { appendActivity, splitThinking } from "./message-details";

/**
 * Optional reproducible profiling recipe — NOT RUN.
 *
 * At the PR head, warm Bun with 100 calls, then take 1,000 samples each of
 * splitThinking("<thinking>" + "reason\\n".repeat(16_384) +
 *   "</thinking>" + "answer\\n".repeat(16_384))
 * and appendActivity(a fixed 65,536-entry status array, "next").
 * Record the head SHA, Bun/OS/CPU versions, median/p95 and allocations.
 * Timing: NOT RUN. Memory: NOT RUN. Device: NOT RUN.
 *
 * These tests deliberately assert correctness, the production 32-entry
 * activity cap and observable index-read bounds, never elapsed time.
 * They import only pure helpers: no store, network, timers or mocks.
 */

describe("splitThinking performance lane", () => {
  test("small inputs preserve explicit leading reasoning and exact answer bytes", () => {
    expect(splitThinking("<think>Reason</think>  \n\tAnswer  \n")).toEqual({
      thinking: "Reason",
      text: "Answer  \n",
    });
    expect(splitThinking(" \n<thinking>Step 1\nStep 2</thinking>\r\n\tDone")).toEqual({
      thinking: "Step 1\nStep 2",
      text: "Done",
    });
    expect(splitThinking("No reasoning")).toEqual({ thinking: "", text: "No reasoning" });
    expect(splitThinking("")).toEqual({ thinking: "", text: "" });
  });

  test("long closed thought and answer remain complete and separate", () => {
    const thought = "reason\n".repeat(16_384);
    const answer = "Answer <think>literal</think>\n".repeat(8_192) + "  \n";
    const source = ` \n<thinking>${thought}</thinking>\r\n\t${answer}`;

    expect(splitThinking(source)).toEqual({ thinking: thought, text: answer });
    expect(source).toContain(answer);
  });

  test("an unfinished stream keeps all thought until its matching close tag", () => {
    const thought = "partial\n".repeat(16_384);
    expect(splitThinking(`<think>${thought}`)).toEqual({ thinking: thought, text: "" });
    expect(splitThinking(`<think>${thought}</thinking>not an answer`)).toEqual({
      thinking: `${thought}</thinking>not an answer`,
      text: "",
    });
    expect(splitThinking(`<think>${thought}</think>  Final\n`)).toEqual({
      thinking: thought,
      text: "Final\n",
    });
  });

  test("reasoning tags inside prose or fenced code never split the reply", () => {
    const prose = "Before <think>not reasoning</think> after\n" + "body\n".repeat(16_384);
    const code = "```xml\n<thinking>literal</thinking>\n```\n" + "body\n".repeat(16_384);
    expect(splitThinking(prose)).toEqual({ thinking: "", text: prose });
    expect(splitThinking(code)).toEqual({ thinking: "", text: code });
  });
});

describe("appendActivity performance lane", () => {
  test("preserves exact bridge statuses, including whitespace and non-adjacent repeats", () => {
    const prior = Object.freeze(["Reading file", "Running tests"]);
    const appended = appendActivity(prior, " Running tests ");
    expect(appended).toEqual(["Reading file", "Running tests", " Running tests "]);
    expect(appended).not.toBe(prior);
    expect(prior).toEqual(["Reading file", "Running tests"]);

    expect(appendActivity(prior, "Reading file")).toEqual([
      "Reading file",
      "Running tests",
      "Reading file",
    ]);
  });

  test("blank and adjacent duplicate updates leave values intact without mutating input", () => {
    const prior = Object.freeze(["step 1", "step 2"]);
    const blank = appendActivity(prior, "  \n\t");
    const duplicate = appendActivity(prior, "step 2");

    expect(blank).toEqual(["step 1", "step 2"]);
    expect(duplicate).toEqual(["step 1", "step 2"]);
    expect(blank).not.toBe(prior);
    expect(duplicate).not.toBe(prior);
    expect(prior).toEqual(["step 1", "step 2"]);
  });

  test("thousands of repeated status updates keep exactly the newest 32 in order", () => {
    let history: readonly string[] = [];
    for (let index = 0; index < 2_048; index++) {
      history = appendActivity(history, `status ${index}`);
      expect(history.length).toBeLessThanOrEqual(32);
    }
    expect(history).toEqual(Array.from({ length: 32 }, (_, index) => `status ${index + 2_016}`));
    expect(appendActivity(history, "status 2047")).toEqual(history);
    expect(appendActivity(history, "status 2048")).toEqual([
      ...history.slice(1),
      "status 2048",
    ]);
  });

  test("a large preexisting status history reads only its tail on append", () => {
    const history = Object.freeze(Array.from({ length: 65_536 }, (_, index) => `step ${index}`));
    const observedIndices: number[] = [];
    const watchedHistory = new Proxy(history, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^(0|[1-9]\\d*)$/.test(property)) {
          observedIndices.push(Number(property));
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const updated = appendActivity(watchedHistory, "new step");
    expect(updated).toEqual([...history.slice(-31), "new step"]);
    expect(updated).toHaveLength(32);
    // Current source checks the last status then slices the final 31.
    // An accidental whole-array copy/scan fails this deterministic bound.
    expect(observedIndices.length).toBeLessThanOrEqual(32);
    expect(observedIndices.every((index) => index >= history.length - 31)).toBe(true);
    expect(history.at(-1)).toBe("step 65535");
  });
});
