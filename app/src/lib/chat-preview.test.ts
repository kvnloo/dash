import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Conversation, Message, UserMessage } from "../model";
import { chatPreview, type ChatPreviewResult } from "./chat-preview";

const base: Pick<Conversation, "messages" | "cwd" | "title" | "sessionId"> = {
  title: "Refactor Dash",
  messages: [],
  cwd: "/home/work/dash",
  sessionId: "session-1",
};

function user(text: string, fields: Partial<UserMessage> = {}): UserMessage {
  return { id: "u", role: "user", text, at: 1, ...fields };
}

function assistant(state: AssistantMessage["state"], text: string, fields: Partial<AssistantMessage> = {}): AssistantMessage {
  return { id: "a", role: "assistant", text, at: 2, state, turnId: "turn-1", seq: 0, ...fields };
}

describe("DF-044 chatPreview priority and concise content", () => {
  const cases: { title: string; messages: Message[]; expected: ChatPreviewResult }[] = [
    {
      title: "permission blocks have a short reason",
      messages: [assistant("streaming", "", { status: "Waiting for approval: edit config.ts" })],
      expected: { kind: "needs-you", text: "Approval needed · edit config.ts" },
    },
    {
      title: "clarifications are needs-you, not generic tool output",
      messages: [assistant("streaming", "", { status: "Clarification required: choose a deployment target" })],
      expected: { kind: "needs-you", text: "Answer needed · choose a deployment target" },
    },
    {
      title: "failed user delivery includes the concrete note",
      messages: [user("Update the build", { delivery: "failed", deliveryNote: "Socket closed while sending" })],
      expected: { kind: "failed", text: "Not sent · Socket closed while sending" },
    },
    {
      title: "failed assistant response uses its actual error",
      messages: [assistant("error", "Incomplete response", { error: "Connection lost" })],
      expected: { kind: "failed", text: "Failed · Connection lost" },
    },
    {
      title: "shell tool status reduces to a verb and object",
      messages: [assistant("streaming", "", { status: "Running shell command: bun test app/src" })],
      expected: { kind: "working", text: "Running tests" },
    },
    {
      title: "editing activity keeps only the file basename",
      messages: [assistant("streaming", "", { status: "Editing app/src/lib/chat-row.ts" })],
      expected: { kind: "working", text: "Editing chat-row.ts" },
    },
    {
      title: "streaming without status does not show a raw delta",
      messages: [assistant("streaming", "unfinished JSON {\"partial\":true}")],
      expected: { kind: "working", text: "Working on reply" },
    },
    {
      title: "completed reply takes its first meaningful sentence after a fence",
      messages: [assistant("done", "\x60\x60\x60json\n{\"internal\":true}\n\x60\x60\x60\n**Fixed the race.** Follow-up details.")],
      expected: { kind: "reply", text: "Fixed the race." },
    },
    {
      title: "the most recent user turn is labeled rather than showing an old reply",
      messages: [assistant("done", "Old reply."), user("  Please verify\n the fix  ")],
      expected: { kind: "you", text: "You: Please verify the fix" },
    },
    {
      title: "empty chat has an explicit kind",
      messages: [],
      expected: { kind: "empty", text: "dash" },
    },
  ];

  for (const entry of cases) {
    test(entry.title, () => {
      expect(chatPreview({ ...base, messages: entry.messages })).toEqual(entry.expected);
    });
  }

  test("live permission wins over failed delivery, work and an older answer", () => {
    expect(chatPreview({
      ...base,
      messages: [
        assistant("done", "Old reply."),
        assistant("streaming", "", { status: "Waiting for permission" }),
        user("Please send", { delivery: "failed", deliveryNote: "Offline" }),
      ],
    })).toEqual({ kind: "needs-you", text: "Approval needed" });
  });

  test("failed delivery outranks a new completed response until resolved", () => {
    expect(chatPreview({
      ...base,
      messages: [
        user("Send this", { delivery: "failed" }),
        assistant("done", "Created a draft."),
      ],
    })).toEqual({ kind: "failed", text: "Not sent · Delivery failed" });
  });

  test("completed status is not mistaken for current streaming work", () => {
    expect(chatPreview({
      ...base,
      messages: [assistant("done", "The patch is ready. Tests are next.", { status: "Running tests" })],
    })).toEqual({ kind: "reply", text: "The patch is ready." });
  });

  test("pending work and handoff have distinct honest descriptions", () => {
    expect(chatPreview({ ...base, messages: [assistant("pending", "")] })).toEqual({ kind: "working", text: "Waiting to start" });
    expect(chatPreview({ ...base, messages: [assistant("streaming", "", { handoff: "queued" })] })).toEqual({ kind: "working", text: "Waiting for host" });
  });
});

describe("DF-044 sanitizing and fallbacks", () => {
  test("fences, indented code, JSON objects and markdown noise do not mask useful prose", () => {
    const reply = [
      "## Activity",
      "Thinking…",
      "~~~shell",
      "curl https://private.example.org/token/a/b/c",
      "~~~",
      "    npm run lint",
      "{\"nested\":{\"command\":\"sh\"},\"ok\":true}",
      "![screenshot](https://example.com/pic.png)",
      "1. **The update is complete.** Full report below.",
    ].join("\n");
    expect(chatPreview({ ...base, messages: [assistant("done", reply)] })).toEqual({
      kind: "reply",
      text: "The update is complete.",
    });
  });

  test("long URLs keep only their host, and inline markdown links keep their label", () => {
    const text = "Open https://docs.example.com/a/very/long/secret/query/path/name/for/the/manual for the details.";
    expect(chatPreview({ ...base, messages: [assistant("done", text)] })).toEqual({
      kind: "reply", text: "Open docs.example.com for the details.",
    });
    expect(chatPreview({ ...base, messages: [assistant("done", "Read [the guide](https://docs.example.com/super/long/path/to/the/docs) first.")] })).toEqual({
      kind: "reply", text: "Read the guide first.",
    });
  });

  test("90-character cap never splits a word or leaks a newline", () => {
    const long = Array.from({ length: 45 }, () => "resolved").join(" ");
    const result = chatPreview({ ...base, messages: [assistant("done", long)] });
    expect(result.kind).toBe("reply");
    expect(result.text.length).toBeLessThanOrEqual(90);
    expect(result.text.endsWith("…")).toBe(true);
    expect(result.text).not.toMatch(/\s…$/);
    expect(result.text).not.toContain("\n");
    expect(long.startsWith(result.text.slice(0, -1))).toBe(true);
  });

  test("single long tokens cannot leak beyond the cap", () => {
    const result = chatPreview({ ...base, messages: [assistant("done", "x".repeat(250))] });
    expect(result).toEqual({ kind: "reply", text: "…" });
  });

  test("fallback order is bridge preview, cwd basename, title, then Empty chat", () => {
    const noMessages = { ...base, messages: [] };
    expect(chatPreview({ ...noMessages, preview: "  Bridge\n  snapshot " })).toEqual({ kind: "empty", text: "Bridge snapshot" });
    expect(chatPreview({ ...noMessages, preview: " ", cwd: "C:\\workspace\\editor\\" })).toEqual({ kind: "empty", text: "editor" });
    expect(chatPreview({ ...noMessages, cwd: undefined, title: "Release review" })).toEqual({ kind: "empty", text: "Release review" });
    expect(chatPreview({ ...noMessages, preview: "", cwd: "/", title: "" })).toEqual({ kind: "empty", text: "Empty chat" });
  });

  test("the output is independent of mutation and can be called repeatedly", () => {
    const messages: Message[] = [user("Rewrite parser"), assistant("done", "Parser updated.")];
    const input = { ...base, messages };
    expect(chatPreview(input)).toEqual(chatPreview(input));
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(assistant("done", "Parser updated."));
  });
});

test("only the last six message slots are inspected, even in a very long history", () => {
  const messages: Message[] = Array.from({ length: 101 }, (_, index) =>
    index === 100 ? assistant("done", "Latest answer.") : user("Earlier text " + index),
  );
  const accessed: number[] = [];
  const guarded = new Proxy(messages, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^(?:0|[1-9]\d*)$/.test(key)) {
        const index = Number(key);
        accessed.push(index);
        if (index < 95) throw new Error("Read outside the most recent six");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  expect(chatPreview({ ...base, messages: guarded })).toEqual({ kind: "reply", text: "Latest answer." });
  expect(accessed).toEqual([100, 99, 98, 97, 96, 95]);
});
