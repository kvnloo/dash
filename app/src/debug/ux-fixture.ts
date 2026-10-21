import type { Conversation, Message } from "../model";

/** Deterministic, local-only transcript for UX qualification. No bridge turns. */
export function uxFixture(): Conversation {
  const messages: Message[] = [];
  for (let i = 1; i <= 24; i++) {
    messages.push({ id: `ux-u-${i}`, role: "user", text: `Prompt ${i}: ${i === 24 ? "Show the scroll-state fix and explain the test." : "Review the agent transcript and keep the useful details."}`, at: i });
    messages.push({ id: `ux-a-${i}`, role: "assistant", state: "done", turnId: `ux-t-${i}`, seq: 0, at: i,
      status: "Read app/src/lib/prompt-navigation.ts · tests passed",
      text: "## Keep the reader in control\n\nThe list follows **new output** only when you are at the bottom. Scrub to an earlier prompt to read without interruption.\n\n```typescript\nconst following = distanceFromBottom <= 48;\nfunction onOutput() {\n  if (following) scrollToEnd();\n}\n```\n\n- Drag the rail to review a prompt.\n- Tap **Latest** to follow the reply again.\n\n```diff\n- scrollToEnd();\n+ if (following) scrollToEnd();\n```" });
  }
  return { id: "ux-long", harness: "hermes", title: "Transcript navigation", createdAt: 1, updatedAt: Date.now(), messages };
}
