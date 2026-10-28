import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { AppState, Platform } from "react-native";
import { notificationState } from "../store/notifications";
import { store } from "../store/app";
import { executionToken } from "./bridge-auth";
import { createNoticePostureReader, nativeNoticeAllowed, notificationChannels } from "./notice-posture";
import { route } from "../../../shared/interaction-policy";
import { notificationLink, parseNotificationTarget, shouldNotify, type DashNotice, type NotificationTarget } from "./notification-policy";

const KEY = "dash.notifications.enabled.v1";
const readNoticePosture = createNoticePostureReader({ now: Date.now, token: executionToken, fetch: (url, init) => fetch(url, init) });
let loaded: Promise<typeof import("expo-notifications") | null> | undefined;
function api() {
  loaded ??= (async () => {
    if (Platform.OS !== "android" || Constants.executionEnvironment === ExecutionEnvironment.StoreClient || !requireOptionalNativeModule("ExpoNotificationScheduler")) return null;
    const notifications: typeof import("expo-notifications") = require("expo-notifications");
    return notifications;
  })();
  return loaded;
}
function failure(error: unknown) {
  notificationState.set(s => ({ ...s, error: error instanceof Error ? error.message : "Notifications are unavailable." }));
}
async function channel() {
  const notifications = await api();
  if (!notifications) return null;
  const channels = notificationChannels(notifications.AndroidImportance, notifications.AndroidNotificationVisibility.PRIVATE);
  for (const config of Object.values(channels)) await notifications.setNotificationChannelAsync(config.id, config);
  return notifications;
}
export async function refreshNotificationPermission(): Promise<void> {
  try {
    const notifications = await api();
    if (!notifications) return;
    const permission = await notifications.getPermissionsAsync();
    notificationState.set(s => ({ ...s, available: true, permission: permission.status, error: "" }));
  } catch (error) { failure(error); }
}
export async function startNativeNotifications(open: (target: NotificationTarget) => void): Promise<() => void> {
  try {
    const notifications = await channel();
    if (!notifications) return () => {};
    const enabled = await AsyncStorage.getItem(KEY) === "true";
    notificationState.set(s => ({ ...s, available: true, enabled }));
    await refreshNotificationPermission();
    notifications.setNotificationHandler({ handleNotification: async (notification: import("expo-notifications").Notification) => {
      const report = Reflect.get(notification.request.content.data ?? {}, "report") === true;
      const show = shouldNotify({ foreground: AppState.currentState === "active", ...notificationState.get(), report });
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: false, shouldSetBadge: false };
    } });
    let lastId: string | undefined;
    const handle = (response: import("expo-notifications").NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER || response.notification.request.identifier === lastId) return;
      lastId = response.notification.request.identifier;
      const target = parseNotificationTarget(response.notification.request.content.data);
      if (target) open(target);
      void notifications.clearLastNotificationResponseAsync().catch(failure);
    };
    const subscription = notifications.addNotificationResponseReceivedListener(handle);
    handle(notifications.getLastNotificationResponse());
    return () => { subscription.remove(); notifications.setNotificationHandler(null); };
  } catch (error) { failure(error); return () => {}; }
}
export async function enableNativeNotifications(): Promise<void> {
  try {
    const notifications = await channel();
    if (!notifications) return;
    const current = await notifications.getPermissionsAsync();
    const permission = current.granted || !current.canAskAgain ? current : await notifications.requestPermissionsAsync();
    await AsyncStorage.setItem(KEY, String(permission.granted));
    notificationState.set(s => ({ ...s, enabled: permission.granted, permission: permission.status,
      error: permission.granted ? "" : "Notifications are blocked. Allow them in Android app settings." }));
  } catch (error) { failure(error); }
}
export async function disableNativeNotifications(): Promise<void> {
  try {
    notificationState.set(s => ({ ...s, enabled: false }));
    await AsyncStorage.setItem(KEY, "false");
    await (await api())?.dismissAllNotificationsAsync();
  } catch (error) { failure(error); }
}
export async function postNativeNotice(notice: DashNotice): Promise<void> {
  if (!shouldNotify({ foreground: AppState.currentState === "active", ...notificationState.get(), report: notice.report })) return;
  try {
    const decision = await readNoticePosture(store.get().settings);
    const routed = route(decision, { cls: notice.class ?? (notice.target.kind === "approvals" ? "decision" : "report"), producer: "dash-notify" }, new Date().toISOString());
    if (!nativeNoticeAllowed(decision, routed)) return;
    const notifications = await channel();
    if (!notifications || !shouldNotify({ foreground: AppState.currentState === "active", ...notificationState.get(), report: notice.report })) return;
    const channels = notificationChannels(notifications.AndroidImportance, notifications.AndroidNotificationVisibility.PRIVATE);
    await notifications.scheduleNotificationAsync({ identifier: notice.key,
      content: { title: notice.title, body: notice.body, sound: false, autoDismiss: true,
        data: { url: notificationLink(notice.target), ...(notice.report ? { report: true } : {}) } },
      trigger: { channelId: channels[routed.channel].id },
    });
  } catch (error) { failure(error); }
}
