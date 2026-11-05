import type { Settings } from "../model";

export const FEEDBACK_CONVERSATION_ID = "dash-feedback";
export const DASH_FEEDBACK_REPO = "kvnloo/dash";

export type FeedbackKind = "typed" | "voice" | "select";

export type FeedbackSelection = {
  kind: "chat" | "orchestra" | "bot" | "search";
  id: string;
  label: string;
};

export type FeedbackAction = {
  kind: FeedbackKind;
  text: string;
  selection?: FeedbackSelection;
};

export type FeedbackIssue = {
  title: string;
  body: string;
  labels: readonly string[];
  repo: typeof DASH_FEEDBACK_REPO;
};

export function inAppFeedbackEnabled(settings: Settings | null): boolean {
  return settings?.inAppFeedback !== false;
}

export function githubIssueFromFeedback(action: FeedbackAction): FeedbackIssue {
  const trimmed = action.text.trim();
  const firstLine = trimmed.split("\n")[0] ?? "";
  const title = (
    action.kind === "select" ? `Feedback: ${action.selection?.label ?? "selection"}` : firstLine || "Dash feedback"
  ).slice(0, 80);
  const selected = action.selection
    ? `Selected ${action.selection.kind} \`${action.selection.id}\` (${action.selection.label})`
    : "";
  const body = [
    trimmed,
    selected,
    "",
    `Source: in-app ${action.kind} feedback (beta).`,
    "Do not replace `.cursor/skills/autodevelop/SKILL.md`.",
  ]
    .filter((line) => line !== "")
    .join("\n");
  return {
    title,
    body,
    labels: ["feedback"],
    repo: DASH_FEEDBACK_REPO,
  };
}

export function steerPromptFromFeedback(action: FeedbackAction, issue: FeedbackIssue): string {
  return [
    "You are the Dash secondmate. This is in-app product feedback from the phone beta.",
    "",
    `File a GitHub issue on ${issue.repo}:`,
    `Title: ${issue.title}`,
    `Labels: ${issue.labels.join(", ")}`,
    "",
    issue.body,
    "",
    "Then follow `.cursor/skills/autodevelop/SKILL.md`. Do not replace that loop.",
  ].join("\n");
}

export function submitFeedback(
  action: FeedbackAction,
  sinks: {
    fileIssue?(issue: FeedbackIssue): void;
    steer(prompt: string): void;
  },
): { issue: FeedbackIssue; prompt: string } {
  const issue = githubIssueFromFeedback(action);
  sinks.fileIssue?.(issue);
  const prompt = steerPromptFromFeedback(action, issue);
  sinks.steer(prompt);
  return { issue, prompt };
}
