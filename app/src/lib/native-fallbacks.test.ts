import { expect, test } from "bun:test";
import { consumeNativeShare, discardNativeShare } from "./native-share";
import { enableNativeNotifications, disableNativeNotifications, refreshNotificationPermission, postNativeNotice, startNativeNotifications } from "./native-notifications";
test("web/native-unavailable adapters stay inert without requiring native modules", async () => {
  expect(await consumeNativeShare()).toBeNull();
  await discardNativeShare("unused");
  await enableNativeNotifications();
  await disableNativeNotifications();
  await refreshNotificationPermission();
  await postNativeNotice({ key: "test", title: "Reply ready", body: "Open Dash", target: { kind: "chat", chatId: "c" } });
  let opened = false;
  const stop = await startNativeNotifications(() => { opened = true; });
  stop();
  expect(opened).toBe(false);
});
