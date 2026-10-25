import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOmpJsonl, ompSessionDirName, readLiveTranscript } from "./roster";

function inTemporarySessions(run: (location: { home: string; sessions: string; alpha: string; beta: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "dash-live-transcript-"));
  const home = join(root, "home");
  const sessions = join(root, "sessions");
  const alpha = join(home, "projects", "alpha");
  const beta = join(home, "projects", "beta");
  try {
    run({ home, sessions, alpha, beta });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeSession(sessions: string, home: string, cwd: string, sessionId: string, answer: string): void {
  const dir = join(sessions, ompSessionDirName(cwd, home));
  mkdirSync(dir, { recursive: true });
  const messages = [
    { type: "session", version: 3, id: sessionId },
    {
      type: "message", id: "u1", timestamp: "2026-10-25T10:00:00.000Z",
      message: { role: "user", content: [{ type: "text", text: "Show me this OMP tab" }] },
    },
    {
      type: "message", id: "think", timestamp: "2026-10-25T10:00:01.000Z",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "private" }] },
    },
    {
      type: "message", id: "tool", timestamp: "2026-10-25T10:00:02.000Z",
      message: { role: "toolResult", content: [{ type: "text", text: "tool output" }] },
    },
    {
      type: "message", id: "a1", timestamp: "2026-10-25T10:00:03.000Z",
      message: { role: "assistant", content: [{ type: "text", text: answer }] },
    },
  ];
  writeFileSync(
    join(dir, `2026-10-25T10-00-00-000Z_${sessionId}.jsonl`),
    `${messages.map(message => JSON.stringify(message)).join("\n")}\n`,
  );
}

describe("issue #26: live OMP transcript hydration", () => {
  test("reads exact user and assistant text from the selected OMP JSONL, not thinking or tool output", () => {
    inTemporarySessions(({ home, sessions, alpha }) => {
      writeSession(sessions, home, alpha, "omp-session-a", "History from alpha");
      const history = readLiveTranscript("omp", "omp-session-a", sessions, alpha, home);
      expect(history).toEqual([
        { id: "u1", role: "user", text: "Show me this OMP tab", at: Date.parse("2026-10-25T10:00:00.000Z") },
        { id: "a1", role: "assistant", text: "History from alpha", at: Date.parse("2026-10-25T10:00:03.000Z") },
      ]);
    });
  });

  test("does not read another working directory's transcript when the selected tab has no matching session", () => {
    inTemporarySessions(({ home, sessions, alpha, beta }) => {
      writeSession(sessions, home, beta, "omp-session-b", "Private beta history");
      // Previously a missing alpha match triggered a global search, exposing beta's history.
      expect(findOmpJsonl(sessions, "omp-session-b", alpha, home)).toBeUndefined();
      expect(readLiveTranscript("omp", "omp-session-b", sessions, alpha, home)).toEqual([]);
      expect(readLiveTranscript("omp", "omp-session-b", sessions, alpha)).toEqual([]);
      expect(readLiveTranscript("omp", "omp-session-b", sessions, beta, home).map(message => message.text)).toEqual([
        "Show me this OMP tab", "Private beta history",
      ]);
      // Older callers without a cwd still have a backwards-compatible exact-ID search.
      expect(readLiveTranscript("omp", "omp-session-b", sessions).map(message => message.text)).toEqual([
        "Show me this OMP tab", "Private beta history",
      ]);
      expect(readLiveTranscript("cursor-cloud", "omp-session-b", sessions, beta, home)).toEqual([]);
      expect(readLiveTranscript("omp", "../omp-session-b", sessions, beta, home)).toEqual([]);
    });
  });

  test("same session id in two directories resolves to the explicitly selected cwd", () => {
    inTemporarySessions(({ home, sessions, alpha, beta }) => {
      writeSession(sessions, home, alpha, "shared-id", "Alpha reply");
      writeSession(sessions, home, beta, "shared-id", "Beta reply");
      expect(readLiveTranscript("omp", "shared-id", sessions, alpha, home).at(-1)?.text).toBe("Alpha reply");
      expect(readLiveTranscript("omp", "shared-id", sessions, beta, home).at(-1)?.text).toBe("Beta reply");
    });
  });

});
