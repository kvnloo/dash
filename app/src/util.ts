import { confirmDialog } from "./lib/dash-dialog";

export { dateGroupLabel, timeAgo } from "./lib/time-labels";

/** Queue a Dash-owned confirmation on every platform; only explicit consent runs the action. */
export function confirmDestructive(title: string, message: string, action: string, onConfirm: () => void): void {
  void confirmDialog(title, message, action, { destructive: true }).then(confirmed => {
    if (confirmed) onConfirm();
  });
}
