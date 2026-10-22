import { describe, expect, test } from "bun:test";
import { chatLink, createReplyNoticeObserver, parseChatLink, parseNotificationTarget, shouldNotify, type DashNotice } from "./notification-policy";
import type { AssistantMessage, Conversation } from "../model";
const reply = (state: AssistantMessage["state"], status?: string): AssistantMessage => ({ id: "m", turnId: "t", seq: 1, role: "assistant", state, status, text: "private reply", at: 1 });
const chat = (message: AssistantMessage): Conversation => ({ id: "c", title: "private title", harness: "hermes", createdAt: 1, updatedAt: 1, messages: [message] });
test("foreground, disabled and denied notifications never alert", () => {
  for (const foreground of [false, true]) for (const enabled of [false, true]) for (const permission of ["granted", "denied", "undetermined", "unavailable"]) {
    expect(shouldNotify({ foreground, enabled, permission })).toBe(!foreground && enabled && permission === "granted");
  }
});
describe("notification event policy", () => {
  test("alerts once for completion and never replays hydrated history", () => {
    const sent: DashNotice[] = [], observe = createReplyNoticeObserver(n => sent.push(n));
    observe([chat(reply("done"))]); expect(sent).toHaveLength(0);
    observe([chat(reply("streaming"))]); observe([chat(reply("done"))]); observe([chat(reply("done"))]);
    expect(sent).toHaveLength(1); expect(sent[0]?.title).toBe("Reply ready");
    expect(JSON.stringify(sent)).not.toContain("private");
  });
  test("separates action needed and errors, ignores normal tools, queues and interruption", () => {
    const sent: DashNotice[] = [], observe = createReplyNoticeObserver(n => sent.push(n));
    observe([chat(reply("streaming", "Running read_file"))]);
    observe([chat(reply("streaming", "Waiting for approval"))]);
    observe([chat(reply("streaming", "Waiting for clarification"))]);
    observe([chat(reply("error"))]); observe([chat(reply("error"))]);
    expect(sent.map(n => n.title)).toEqual(["Action needed", "Reply failed"]);
    observe([chat(reply("streaming"))]); observe([chat(reply("interrupted"))]);
    expect(sent).toHaveLength(2);
  });
  test("does not alert for newly imported historical messages", () => {
    const sent: DashNotice[] = [], observe = createReplyNoticeObserver(n => sent.push(n));
    observe([]); observe([chat(reply("error"))]); expect(sent).toHaveLength(0);
  });
});
test("only routes validated Dash notification links, not arbitrary URLs", () => {
  expect(parseChatLink(chatLink("chat 1"))).toBe("chat 1");
  expect(parseNotificationTarget({ url: chatLink("c") })).toEqual({ kind: "chat", chatId: "c" });
  expect(parseNotificationTarget({ url: "dash://approvals" })).toEqual({ kind: "approvals" });
  for (const url of ["https://evil/chat/c", "dash://connect?token=x", "dash://chat/", "dash://chat/a/b", "dash://chat/%ZZ", "dash://chat/c?token=x", "dash://chat/%00"]) expect(parseNotificationTarget({ url })).toBeNull();
  expect(parseNotificationTarget(null)).toBeNull();
});
