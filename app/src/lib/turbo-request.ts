import { Platform } from "react-native";
import { TURBO } from "../turbo";
import type { Conversation } from "../model";

// The public tester army uses the same preview UI, without enabling it for normal web users.
export const turboRequests = TURBO || (Platform.OS === "web" &&
  process.env.EXPO_PUBLIC_DASH_VOICE_FAKE === "1" &&
  typeof location !== "undefined" && new URLSearchParams(location.search).get("turboRequest") === "1");

export function findTurboTarget(conversations: readonly Conversation[], address?: string, selected?: string | null): Conversation | undefined {
  if (!address) return undefined;
  const targets = conversations.filter(c => !c.stale && !c.viewOnly && c.harness === "claude" &&
    c.endpointAddress === address && !!c.sessionId && /(?:^|\/)dash-turbo\/?$/.test(c.cwd ?? ""));
  return targets.find(c => c.id === selected) ?? (targets.length === 1 ? targets[0] : undefined);
}
