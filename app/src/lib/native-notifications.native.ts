import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import { AppState, Platform } from "react-native";
import { notificationState } from "../store/notifications";
import { notificationLink, parseNotificationTarget, shouldNotify, type DashNotice, type NotificationTarget } from "./notification-policy";

const KEY = "dash.notifications.enabled.v1";
const CHANNEL = "dash-updates";
let loaded: Promise<typeof import("expo-notifications") | null> | undefined;
function api() {
  loaded ??= (async () => {
    if (Platform.OS !== "android" || Constants.executionEnvironment === ExecutionEnvironment.StoreClient || !requireOptionalNativeModule("ExpoNotificationScheduler")) return null;
    return require("expo-notifications") as typeof import("expo-notifications");
  })();
  return loaded;
}
function failure(error: unknown) {
  notificationState.set(s => ({ ...s, error: error instanceof Error ? error.message : "Notifications are unavailable." }));
}
async function channel() {
  const notifications = await api();
  if (!notifications) return null;
  await notifications.setNotificationChannelAsync(CHANNEL, {
    name: "Replies, reports and action needed", importance: notifications.AndroidImportance.DEFAULT,
    sound: null, enableVibrate: false, showBadge: false,
    lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
  });
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
    notifications.setNotificationHandler({ handleNotification: async () => {
      const show = AppState.currentState !== "active" && notificationState.get().enabled;
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
  if (!shouldNotify({ foreground: AppState.currentState === "active", ...notificationState.get() })) return;
  try {
    const notifications = await api();
    if (!notifications || AppState.currentState === "active" || !notificationState.get().enabled) return;
    await notifications.scheduleNotificationAsync({ identifier: notice.key,
      content: { title: notice.title, body: notice.body, sound: false, autoDismiss: true,
        data: { url: notificationLink(notice.target) } },
      trigger: { channelId: CHANNEL },
    });
  } catch (error) { failure(error); }
}
