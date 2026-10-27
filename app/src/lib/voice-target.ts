/** The Hermes chat a live voice call binds to. Pure so the rule is testable without React Native. */
export interface VoiceTargetCandidate {
  readonly id: string;
  readonly harness: string;
  readonly sessionId?: string;
  readonly profileId?: string;
  readonly updatedAt: number;
  readonly stale?: boolean;
}

export function attachedHermes(c: VoiceTargetCandidate | undefined): boolean {
  return !!c && c.harness === "hermes" && !!c.sessionId && !!c.profileId && !c.stale;
}

/**
 * The open chat wins when it is an attached Hermes chat. Otherwise (conversation mode opened from the
 * main screen, or the open chat is another harness/new/stale) use the most recently active attached
 * Hermes chat instead of refusing before the microphone is ever requested.
 */
export function voiceTarget<T extends VoiceTargetCandidate>(conversations: readonly T[], activeId: string | null | undefined): T | undefined {
  const active = conversations.find(c => c.id === activeId);
  if (attachedHermes(active)) return active;
  let best: T | undefined;
  for (const c of conversations) if (attachedHermes(c) && (!best || c.updatedAt > best.updatedAt)) best = c;
  return best;
}
