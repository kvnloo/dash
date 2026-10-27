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
  expect(emitted).toEqual([{ key: "notice:n1", title: "Report", body: "Passed", target: { kind: "chat", chatId: "c1" }, report: true }]);
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
test("reports notify even in the foreground, so a foreground reconnect replay still posts natively", async () => {
  for (const foreground of [false, true]) for (const enabled of [false, true]) for (const permission of ["granted", "denied"]) {
    const emitted: DashNotice[] = [];
    const inbox = createAgentNoticeInbox({ emit: n => { if (shouldNotify({ foreground, enabled, permission, report: n.report })) emitted.push(n); } });
    await inbox.receive(notice); expect(inbox.list()).toHaveLength(1);
    expect(emitted.length).toBe(enabled && permission === "granted" ? 1 : 0);
  }
  // Replies and approvals keep the old rule: the open app already shows them.
  expect(shouldNotify({ foreground: true, enabled: true, permission: "granted" })).toBe(false);
  expect(shouldNotify({ foreground: true, enabled: true, permission: "granted", report: false })).toBe(false);
  expect(shouldNotify({ foreground: false, enabled: true, permission: "granted" })).toBe(true);
  expect(parseNotificationTarget({ url: "dash://notices" })).toEqual({ kind: "notices" });
  expect(notificationLink({ kind: "notices" })).toBe("dash://notices");
});
test("reconnect replay emits exactly the unseen ids for native delivery", async () => {
  const emitted: DashNotice[] = []; const inbox = createAgentNoticeInbox({ emit: n => { emitted.push(n); } });
  await inbox.receive({ ...notice, id: "a" });
  for (const id of ["a", "b", "c"]) await inbox.receive({ ...notice, id, url: undefined });
  expect(emitted.map(n => n.key)).toEqual(["notice:a", "notice:b", "notice:c"]);
});
test("forget clears the phone inbox and asks the bridge to clear its ring", async () => {
  let saved: string | null = null; const sent: unknown[] = [];
  const inbox = createAgentNoticeInbox({ storage: { read: async () => saved, write: async (s: string) => { saved = s; } }, emit: () => {} });
  await inbox.receive(notice);
  await inbox.forget(m => { sent.push(m); return true; });
  expect(sent).toEqual([{ type: "notices_clear" }]);
  expect(inbox.list()).toEqual([]); expect(String(saved)).toBe("[]");
});
