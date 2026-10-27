import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSettings } from "../model";
import {
  FEEDBACK_CONVERSATION_ID,
  githubIssueFromFeedback,
  inAppFeedbackEnabled,
  steerPromptFromFeedback,
  submitFeedback,
} from "./feedback";

describe("in-app feedback", () => {
  test("beta default is on, including settings persisted before the flag existed", () => {
    expect(inAppFeedbackEnabled(null)).toBe(true);
    const parsed = parseSettings({
      address: "100.64.0.1:4747",
      token: "tok",
      harness: "omp",
    });
    expect(parsed?.inAppFeedback).toBe(true);
    expect(inAppFeedbackEnabled(parsed)).toBe(true);
  });

  test("explicit false disables later", () => {
    const parsed = parseSettings({
      address: "100.64.0.1:4747",
      token: "tok",
      harness: "omp",
      inAppFeedback: false,
    });
    expect(parsed?.inAppFeedback).toBe(false);
    expect(inAppFeedbackEnabled(parsed)).toBe(false);
  });

  test("typed, voice, and select actions create a GitHub issue and a secondmate steer", () => {
    const typed = { kind: "typed" as const, text: "The composer should stay visible." };
    const voice = { kind: "voice" as const, text: "Cold open still shows an empty chat." };
    const select = {
      kind: "select" as const,
      text: "This orchestra card",
      selection: { kind: "orchestra" as const, id: "dash", label: "dash" },
    };

    for (const action of [typed, voice, select]) {
      const issues: Array<{ title: string; body: string }> = [];
      const steers: string[] = [];
      const result = submitFeedback(action, {
        fileIssue: (issue) => issues.push(issue),
        steer: (prompt) => steers.push(prompt),
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.title.length).toBeGreaterThan(0);
      expect(issues[0]?.body).toContain(action.text);
      expect(issues[0]?.repo).toBe("kvnloo/dash");
      expect(steers).toHaveLength(1);
      expect(steers[0]).toContain("secondmate");
      expect(steers[0]).toContain(".cursor/skills/autodevelop/SKILL.md");
      expect(result.issue).toEqual(issues[0]);
      expect(githubIssueFromFeedback(action).labels).toContain("feedback");
      expect(steerPromptFromFeedback(action, result.issue)).toBe(steers[0]);
    }

    expect(githubIssueFromFeedback(select).body).toContain("dash");
  });

  test("Main composer, Voice, and list long-press stay wired to feedback", () => {
    const main = readFileSync(join(import.meta.dir, "../screens/MainScreen.tsx"), "utf8");
    const settings = readFileSync(join(import.meta.dir, "../screens/SettingsScreen.tsx"), "utf8");
    const chats = readFileSync(join(import.meta.dir, "../screens/panes/ChatsPane.tsx"), "utf8");
    const orchestra = readFileSync(join(import.meta.dir, "../screens/panes/OrchestraPane.tsx"), "utf8");
    const bots = readFileSync(join(import.meta.dir, "../screens/panes/BotsPane.tsx"), "utf8");
    const search = readFileSync(join(import.meta.dir, "../components/SearchResultRow.tsx"), "utf8");
    expect(main).toContain("inAppFeedbackEnabled");
    expect(main).toContain("submitInAppFeedback");
    expect(main).toContain("FEEDBACK_CONVERSATION_ID");
    expect(main).not.toContain("onVoice={() => navigation.navigate(\"Voice\")}");
    expect(settings).toContain("inAppFeedback");
    expect(settings).toContain("In-app feedback");
    expect(chats).toContain("submitInAppFeedback");
    expect(orchestra).toContain("submitInAppFeedback");
    expect(bots).toContain("submitInAppFeedback");
    expect(search).toContain("onLongPress");
    expect(FEEDBACK_CONVERSATION_ID).toBe("dash-feedback");
  });
});
