import { expect, test } from "bun:test";
import { createAgentNoticeInbox } from "./agent-notices";
import { shouldNotify, parseNotificationTarget, notificationLink, type DashNotice } from "./notification-policy";
import type { NoticeMessage } from "../../../shared/protocol";
const notice: NoticeMessage = { type: "notice", id: "n1", title: "Report", body: "Passed", url: "dash://chat/c1" };
test("handler uses native pipeline, persists, and dedupes reconnect and app restart", async () => {
  let saved: string | null = null; const emitted: DashNotice[] = [];
  const storage = { read: async () => saved, write: async (s: string) => { saved = s; } };
  const inbox = createAgentNoticeInbox({ storage, emit: n => { emitted.push(n); } });
  await Promise.all([inbox.receive(notice), inbox.receive(notice)]);
  expect(emitted).toEqual([{ key: "notice:n1", title: "Report", body: "Passed", target: { kind: "chat", chatId: "c1" } }]);
  expect(inbox.list()).toEqual([notice]);
  const restarted = createAgentNoticeInbox({ storage, emit: n => { emitted.push(n); } });
  await restarted.receive(notice); expect(emitted).toHaveLength(1);
  await restarted.receive({ ...notice, id: "n2", url: undefined });
  expect(emitted[1]?.target).toEqual({ kind: "notices" });
});
test("last 50 newest first; replay older retained notices is quiet", async () => {
  const emitted: DashNotice[] = []; const inbox = createAgentNoticeInbox({ emit: n => { emitted.push(n); } });
  for (let i = 0; i < 55; i++) await inbox.receive({ ...notice, id: String(i) });
  expect(inbox.list()).toHaveLength(50); expect(inbox.list()[0]?.id).toBe("54");
  for (let i = 5; i < 55; i++) await inbox.receive({ ...notice, id: String(i) });
  expect(emitted).toHaveLength(55);
});
test("reports respect existing foreground, enabled and permission policy", async () => {
  for (const foreground of [false, true]) for (const enabled of [false, true]) for (const permission of ["granted", "denied"]) {
    const emitted: DashNotice[] = [];
    const inbox = createAgentNoticeInbox({ emit: n => { if (shouldNotify({ foreground, enabled, permission })) emitted.push(n); } });
    await inbox.receive(notice); expect(inbox.list()).toHaveLength(1);
    expect(emitted.length).toBe(!foreground && enabled && permission === "granted" ? 1 : 0);
  }
  expect(parseNotificationTarget({ url: "dash://notices" })).toEqual({ kind: "notices" });
  expect(notificationLink({ kind: "notices" })).toBe("dash://notices");
});
