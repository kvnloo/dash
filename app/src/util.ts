import { Alert, Platform } from "react-native";

export { dateGroupLabel, timeAgo } from "./lib/time-labels";

/** Destructive confirmation that also works on web, where `Alert` is a no-op. */
export function confirmDestructive(title: string, message: string, action: string, onConfirm: () => void): void {
  if (Platform.OS === "web") {
    if (globalThis.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: "destructive", onPress: onConfirm },
  ]);
}
