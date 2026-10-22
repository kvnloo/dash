import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AssistantMessage, Conversation } from "../model";
import { chatRow } from "./chat-row";

const base: Conversation = { id: "c", harness: "hermes", title: "Repair pairing", createdAt: 1, updatedAt: 2, messages: [] };
const answer = (text: string, state: AssistantMessage["state"] = "done"): AssistantMessage => ({ id: "a", role: "assistant", text, state, at: 2, turnId: "t", seq: 0 });

test("rich rows expose the supplied title, folder and first completed reply sentence", () => {
  expect(chatRow({ ...base, cwd: "/workspace/dash/", messages: [answer("Pairing now keeps errors visible. The retry test passes.")] }, "Hermes", "online")).toEqual({
    title: "Repair pairing", folder: "Folder · dash", folderPath: "/workspace/dash/", outcome: "Pairing now keeps errors visible.", outcomeLabel: "Last reply", activity: "No active turn", needsAttention: false,
  });
});

test("missing metadata stays unknown, and a user prompt is not a summary", () => {
  expect(chatRow({ ...base, title: " ", messages: [{ id: "u", role: "user", text: "Ship this now", at: 1 }] }, "Hermes", "online")).toMatchObject({
    title: "Hermes", folder: "Folder unknown", folderPath: undefined, outcome: "No summary yet", outcomeLabel: null, activity: "No active turn",
  });
  expect(chatRow({ ...base, cwd: "/" }, "Hermes", "online").folder).toBe("Folder · /");
});

test("streaming, failed and interrupted text never become completed outcomes", () => {
  for (const state of ["streaming", "pending", "error", "interrupted"] as const) {
    expect(chatRow({ ...base, messages: [answer("Unfinished claim", state)] }, "Hermes", "online").outcome).toBe("No summary yet");
  }
  expect(chatRow({ ...base, messages: [answer("Saved the patch. More details."), answer("Now testing", "streaming")] }, "Hermes", "online")).toMatchObject({ outcome: "Saved the patch.", outcomeLabel: "Last reply", activity: "Running · replying" });
});

test("activity comes from turn state, not host process presence or stale tool text", () => {
  const working = { ...base, messages: [{ ...answer("", "streaming"), status: "Running tests" }] };
  expect(chatRow(working, "Hermes", "online").activity).toBe("Running tests");
  expect(chatRow(working, "Hermes", "offline").activity).toBe("Activity unknown · offline");
  expect(chatRow(working, "Hermes", "connecting").activity).toBe("Activity unknown · connecting");
  expect(chatRow(working, "Hermes", "idle").activity).toBe("Activity unknown · disconnected");
  expect(chatRow({ ...working, stale: true }, "Hermes", "online").activity).toBe("Ended");
  expect(chatRow({ ...working, messages: [{ ...working.messages[0]!, handoff: "queued" }] }, "Hermes", "online").activity).toBe("Waiting for host");
  expect(chatRow({ ...working, messages: [{ ...working.messages[0]!, delivery: "queued" }] }, "Hermes", "online").activity).toBe("Queued");
  expect(chatRow({ ...base, messages: [answer("", "pending")] }, "Hermes", "online").activity).toBe("Waiting to start");
  expect(chatRow({ ...working, messages: [{ ...working.messages[0]!, handoff: "sending" }] }, "Hermes", "online").activity).toBe("Sending to host");
  expect(chatRow({ ...base, openIn: "CLI" }, "Hermes", "online").activity).toBe("Open in CLI");
  expect(chatRow({ ...base, messages: [{ ...answer("Saved."), status: "Running tests" }] }, "Hermes", "online").activity).toBe("No active turn");
  expect(chatRow({ ...base, messages: [answer("", "error")] }, "Hermes", "online")).toMatchObject({ activity: "Needs attention", needsAttention: true });
});

test("empty completed replies do not hide a prior useful reply; excerpts preserve literal text", () => {
  expect(chatRow({ ...base, messages: [answer("Use v1.2 in dash.config.ts. Then retry."), answer(" \n ")] }, "Hermes", "online").outcome).toBe("Use v1.2 in dash.config.ts.");
  expect(chatRow({ ...base, messages: [answer("\n  Patch saved\n\nTests are next")] }, "Hermes", "online").outcome).toBe("Patch saved");
});

test("row actions and existing open/delete/feedback wiring remain unchanged", () => {
  const source = readFileSync(new URL("../screens/panes/ChatsPane.tsx", import.meta.url), "utf8");
  expect(source).toContain('onPress={() => onPress(item.id)}');
  expect(source).toContain('onLongPress={() => onLongPress(item.id)}');
  expect(source).toContain('delayLongPress={350}');
  expect(source).toContain(`(id: string) => {\n      haptic.select();\n      setActive(id);\n      navigation.navigate("Chat");\n    },`);
  expect(source).toContain('confirmDestructive("Delete chat?", "This removes it from this phone only.", "Delete", () => {\n      deleteConversation(id);\n    });');
  expect(source).toContain('onPress={open}');
  expect(source).toContain('onLongPress={feedbackOn ? onFeedback : remove}');
  expect(source).toContain('selection: { kind: "chat", id, label: conversation?.title || id }');
  expect(source).toContain('chatRow(item, harnessName, connectionStatus)');
  expect(source).toContain('{content.folder}');
  expect(source).toContain('{content.outcome}');
  expect(source).toContain('{content.activity}');
});
