import type { DashNotice, NotificationTarget } from "./notification-policy";
import type { NoticeAction, PermissionRef } from "./notification-actions";
export async function startNativeNotifications(_open: (target: NotificationTarget) => void, _act?: (action: NoticeAction, ref: PermissionRef) => void): Promise<() => void> { return () => {}; }
export async function enableNativeNotifications(): Promise<void> {}
export async function disableNativeNotifications(): Promise<void> {}
export async function refreshNotificationPermission(): Promise<void> {}
export async function postNativeNotice(_notice: DashNotice): Promise<void> {}
export async function dismissNativeNotice(_key: string): Promise<void> {}
