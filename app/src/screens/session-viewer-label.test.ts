import { expect, test } from "bun:test";
import { sessionViewerLabel } from "./session-viewer-label";
import { composerPlaceholder } from "./composer-placeholder";

test("uses the OS hostname instead of the MagicDNS label and does not invent a handoff", () => {
  const host = { id: "0", name: "0", hostname: "groot", online: true, self: true, agents: [] };
  expect(sessionViewerLabel("CLI", "0", { hosts: [host] })).toBe("Also open in CLI on groot · reply here to continue");
  expect(sessionViewerLabel("CLI", "groot", { hosts: [host] })).toContain("on groot");
  expect(sessionViewerLabel("TUI", undefined, { hosts: [], host: "laptop" })).toContain("on laptop");
  expect(sessionViewerLabel("CLI", undefined, { hosts: [] })).toContain("on the host");
});

test("a Hermes viewer does not label a new reply as queued", () => {
  expect(composerPlaceholder({ online: true, streaming: false, queued: 0, openIn: "CLI", harness: "hermes", harnessName: "clean" })).toBe("Reply to session…");
});
