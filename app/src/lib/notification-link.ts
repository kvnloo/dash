import type { NotificationTarget } from "./notification-policy";

// Inspect the original deep link before URL parsing can normalize dot segments,
// userinfo, ports, or trailing empty query and fragment delimiters.
const CHAT_LINK = /^dash:\/\/chat\/([^?#]*)$/i;
const CONTROL_BYTES = /[\x00-\x1f\x7f]/;

export function parseChatLink(url: string | null): string | null {
  if (typeof url !== "string") return null;

  const match = CHAT_LINK.exec(url);
  if (!match || match[0] !== url) return null;

  const segment = match[1];
  if (!segment || segment.includes("/")) return null;

  try {
    // Decode once only. Identifiers are opaque and must retain case and spacing.
    const id = decodeURIComponent(segment);
    if (
      id.length === 0 ||
      id.length > 200 ||
      id.trim().length === 0 ||
      id === "." ||
      id === ".." ||
      id.includes("/") ||
      id.includes("\\") ||
      CONTROL_BYTES.test(id)
    ) return null;
    return id;
  } catch {
    return null;
  }
}

export function parseNotificationTarget(data: unknown): NotificationTarget | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;

  let url: unknown;
  try {
    url = Reflect.get(data, "url");
  } catch {
    return null;
  }

  if (url === "dash://notices") return { kind: "notices" };
  if (url === "dash://approvals") return { kind: "approvals" };
  const chatId = typeof url === "string" ? parseChatLink(url) : null;
  return chatId === null ? null : { kind: "chat", chatId };
}
