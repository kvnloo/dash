import type { DashNotice, NotificationTarget } from "./notification-policy";
export async function startNativeNotifications(_open: (target: NotificationTarget) => void): Promise<() => void> { return () => {}; }
export async function enableNativeNotifications(): Promise<void> {}
export async function disableNativeNotifications(): Promise<void> {}
export async function refreshNotificationPermission(): Promise<void> {}
export async function postNativeNotice(_notice: DashNotice): Promise<void> {}
