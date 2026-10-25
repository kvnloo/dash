import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostInfo } from "../../shared/protocol";
import type { Conversation } from "../../app/src/model";
import { hydrateLiveConversation, mergeLiveConversations, shouldRequestHistory } from "../../app/src/lib/live-sessions";
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
  test("opens a live catalog row with exact user/assistant history and preserves its session identity", () => {
    inTemporarySessions(({ home, sessions, alpha }) => {
      writeSession(sessions, home, alpha, "omp-session-a", "History from alpha");
      const hosts: HostInfo[] = [{
        id: "mbp", name: "mbp", hostname: "mbp", online: true, self: true,
        agents: [{
          id: "omp:tab-a", name: "OMP", kind: "omp", status: "running",
          sessionId: "omp-session-a", cwd: alpha,
        }],
      }];
      // HostInfo is checked through the real adoption API, not a hand-made chat.
      const listed = mergeLiveConversations([], hosts, Date.parse("2026-10-25T10:00:05.000Z"));
      expect(listed).toHaveLength(1);
      const live = listed[0];
      if (!live) throw new Error("Live OMP row was not adopted");
      expect(live.id).toBe("live:omp:omp-session-a");
      expect(live.messages).toEqual([]);
      expect(shouldRequestHistory(live)).toBe(true);
      const history = readLiveTranscript("omp", live.sessionId ?? "", sessions, live.cwd, home);
      expect(history.map(message => ({ id: message.id, role: message.role, text: message.text }))).toEqual([
        { id: "u1", role: "user", text: "Show me this OMP tab" },
        { id: "a1", role: "assistant", text: "History from alpha" },
      ]);
      const hydrated = hydrateLiveConversation(live, history);
      expect(hydrated.id).toBe(live.id);
      expect(hydrated.sessionId).toBe("omp-session-a");
      expect(hydrated.messages.map(message => message.text)).toEqual(["Show me this OMP tab", "History from alpha"]);
      expect(shouldRequestHistory(hydrated)).toBe(false);
      expect(mergeLiveConversations([hydrated], hosts, Date.now())).toHaveLength(1);
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

  test("in-flight assistant turn remains attached rather than replaced by historical messages", () => {
    inTemporarySessions(({ home, sessions, alpha }) => {
      writeSession(sessions, home, alpha, "in-flight", "Historical answer");
      const [live] = mergeLiveConversations([], [{
        id: "mbp", name: "mbp", hostname: "mbp", online: true, self: true,
        agents: [{ id: "omp:tab", name: "OMP", kind: "omp", status: "running", sessionId: "in-flight", cwd: alpha }],
      }], 1_700_000_000_000);
      if (!live) throw new Error("Missing live OMP row");
      const streaming: Conversation = {
        ...live,
        messages: [{
          id: "a-running", role: "assistant", state: "streaming",
          text: "partial", at: 1_700_000_000_000, turnId: "turn-in-flight", seq: 3,
        }],
      };
      expect(shouldRequestHistory(streaming)).toBe(false);
      expect(hydrateLiveConversation(streaming, readLiveTranscript("omp", "in-flight", sessions, alpha, home))).toBe(streaming);
    });
  });
});
