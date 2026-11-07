/** The Hermes chat a live voice call binds to. Pure so the rule is testable without React Native. */
export interface VoiceTargetCandidate {
  readonly id: string;
  readonly harness: string;
  readonly endpointAddress?: string;
  readonly sessionId?: string;
  readonly profileId?: string;
  readonly updatedAt: number;
  readonly stale?: boolean;
}

export function attachedHermes(c: VoiceTargetCandidate | undefined, endpointAddress: string | undefined): boolean {
  return !!endpointAddress && !!c && c.endpointAddress === endpointAddress && c.harness === "hermes" && !!c.sessionId && !!c.profileId && !c.stale;
}

/**
 * The open chat wins only when it is an attached Hermes chat owned by this paired address.
 * Otherwise use the most recently active attached Hermes chat owned by that address.
 * Missing legacy provenance and foreign endpoints never acquire a voice binding.
 */
export function voiceTarget<T extends VoiceTargetCandidate>(conversations: readonly T[], activeId: string | null | undefined, endpointAddress: string | undefined): T | undefined {
  const active = conversations.find(c => c.id === activeId);
  if (attachedHermes(active, endpointAddress)) return active;
  let best: T | undefined;
  for (const c of conversations) if (attachedHermes(c, endpointAddress) && (!best || c.updatedAt > best.updatedAt)) best = c;
  return best;
}
