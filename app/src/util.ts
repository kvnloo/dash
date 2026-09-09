import { Alert, Platform } from "react-native";

export function dateGroupLabel(at: number, now = Date.now()): string {
  const dayMs = 86_400_000;
  const startOf = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOf(now);
  const then = startOf(at);
  const diff = today - then;
  if (diff === 0) return "Today";
  if (diff === dayMs) return "Yesterday";
  if (diff < 7 * dayMs) return "This week";
  return new Date(at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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
