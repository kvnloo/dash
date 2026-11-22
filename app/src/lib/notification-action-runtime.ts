import { permissionRequests } from "../net/bridge";
import { optionForAction, type NoticeAction, type PermissionRef } from "./notification-actions";

/** A notification button press: answer the live request with its own offered option.
 * Unknown, settled or expired requests do nothing here; the tap still opens the chat, whose
 * PermissionCard shows the real state. The bridge's permission_resolved is the only grant. */
export function answerFromNotification(action: NoticeAction, ref: PermissionRef): void {
  const record = permissionRequests.recordFor(ref);
  if (!record || record.phase !== "pending") return;
  const optionId = optionForAction(record, action);
  if (optionId) void permissionRequests.decide(record, optionId);
}
