import { expect, test, describe } from "bun:test";
import { HERMES_CHAT_SOURCES, visible } from "./hermes-sessions";

describe("HERMES_CHAT_SOURCES includes gui", () => {
  test("gui is in the allowlist", () => {
    expect(HERMES_CHAT_SOURCES).toContain("gui");
  });

  test("visible() returns true for source=gui", () => {
    const row = { source: "gui", archived: false, hidden: false, is_internal_child: false, model_config: null };
    expect(visible(row as any)).toBe(true);
  });

  test("visible() still rejects non-human sources", () => {
    const row = { source: "cron", archived: false, hidden: false, is_internal_child: false, model_config: null };
    expect(visible(row as any)).toBe(false);
  });
});
