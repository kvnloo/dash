import { describe, expect, test } from "bun:test";
import { COMPOSER_PLACEHOLDER_MAX, composerPlaceholder } from "./composer-placeholder";

describe("composer placeholder", () => {
  const harnesses = ["OMP", "Codex", "Grok", "Claude Code", "Hermes", "jev-provider-bench", "a-very-long-hermes-profile-name"];
  const states = harnesses.flatMap((harnessName) =>
    [true, false].flatMap((online) =>
      [true, false].flatMap((streaming) =>
        [0, 3, 120].flatMap((queued) => [undefined, "CLI", "desktop"].map((openIn) => ({ online, streaming, queued, openIn, harnessName }))))));

  test("every state fits the one-line composer", () => {
    for (const state of states) expect(composerPlaceholder(state).length).toBeLessThanOrEqual(COMPOSER_PLACEHOLDER_MAX);
  });

  test("names the action for each state", () => {
    expect(composerPlaceholder({ online: false, streaming: false, queued: 0, harnessName: "OMP" })).toBe("Waiting for the bridge…");
    expect(composerPlaceholder({ online: true, streaming: true, queued: 0, harnessName: "Codex" })).toBe("Queue next message…");
    expect(composerPlaceholder({ online: true, streaming: true, queued: 2, harnessName: "Codex" })).toBe("Queue another (2)…");
    expect(composerPlaceholder({ online: true, streaming: false, queued: 0, openIn: "CLI", harnessName: "clean" })).toBe("Queue a reply…");
    expect(composerPlaceholder({ online: true, streaming: false, queued: 0, harnessName: "Claude Code" })).toBe("Message Claude Code");
  });
});
