import { describe, expect, test } from "bun:test";
import { isSelfArchiveProfile } from "./agentsview-sessions";

// The Hosts tree lists finished local sessions with the roster id `<harness>:session:<id>`
// (finished-sessions.ts) and the app sends that id as profileId when Kevin continues one.
describe("continuing a listed session on this host", () => {
  const sid = "7ff388b9-b5dd-4808-b87f-738a8f153abc";
  test("AgentsView archive id is accepted", () => {
    expect(isSelfArchiveProfile(`av:claude:${sid}`, "claude", sid)).toBe(true);
  });
  test("local-store roster id from the Hosts tree is accepted", () => {
    expect(isSelfArchiveProfile(`claude:session:${sid}`, "claude", sid)).toBe(true);
    expect(isSelfArchiveProfile(`codex:session:${sid}`, "codex", sid)).toBe(true);
  });
  test("a roster id for another session, harness or no session is refused", () => {
    expect(isSelfArchiveProfile(`claude:session:${sid}`, "claude", "other")).toBe(false);
    expect(isSelfArchiveProfile(`claude:session:${sid}`, "codex", sid)).toBe(false);
    expect(isSelfArchiveProfile(`claude:session:${sid}`, "claude", undefined)).toBe(false);
    expect(isSelfArchiveProfile("hermes:tek", "claude", sid)).toBe(false);
  });
});
