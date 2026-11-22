// What a live call shows and hears about pending approvals (DA-058). Pure: no React Native.
//
// Safety rules (same as the Needs OK notification, #555):
// - "Allow" maps only to an allow_once option, never allow_always. "Deny" maps to reject_once.
// - Only a short utterance that is clearly an approval command is consumed; anything else is a
//   normal voice request. Nothing is consumed while no approval is pending.
// - sudo needs the password, so speech never grants it: "allow" opens the #670 entry instead.
// - The bridge's permission_resolved / secret_resolved stays the only grant.

type OptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";
export interface PendingPermissionLike {
  readonly conversationId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly options: readonly { optionId: string; kind: OptionKind }[];
  readonly phase: string;
  readonly deadlineAt: number;
  readonly error: string | null;
}
export interface PendingSudoLike { readonly id: string; readonly command: string; readonly account: string; readonly expiresAt: number }

export type VoiceApproval<P extends PendingPermissionLike = PendingPermissionLike, S extends PendingSudoLike = PendingSudoLike> =
  | { kind: "sudo"; request: S }
  | { kind: "permission"; record: P; title: string; allowOptionId: string | null; denyOptionId: string | null; deciding: boolean };

export type SpokenApproval = "allow" | "deny" | "open";

/** The one approval the call surfaces: a sudo request first (it holds a shell command), then the oldest Needs OK. */
export function pickVoiceApproval<P extends PendingPermissionLike, S extends PendingSudoLike>(
  records: readonly P[], sudo: readonly S[], now: number, titleOf: (conversationId: string) => string | undefined,
): VoiceApproval<P, S> | null {
  const request = sudo.find(item => now < item.expiresAt);
  if (request) return { kind: "sudo", request };
  const pending = records
    .filter(record => (record.phase === "pending" || record.phase === "deciding") && now < record.deadlineAt)
    .sort((a, b) => a.deadlineAt - b.deadlineAt)[0];
  if (!pending) return null;
  return {
    kind: "permission",
    record: pending,
    title: titleOf(pending.conversationId)?.trim() || "an agent",
    allowOptionId: pending.options.find(option => option.kind === "allow_once")?.optionId ?? null,
    denyOptionId: pending.options.find(option => option.kind === "reject_once")?.optionId ?? null,
    deciding: pending.phase === "deciding",
  };
}

const ALLOW = /^(?:(?:yes|yeah|ok|okay|sure)\s+)?(?:allow|approve)(?:\s+(?:it|that|this))?(?:\s+once)?(?:\s+please)?$/;
const DENY = /^(?:no\s+)?(?:deny|reject|decline|don't allow|do not allow)(?:\s+(?:it|that|this))?(?:\s+please)?$/;
const OPEN = /^(?:open|show)(?:\s+the)?\s+(?:sudo|password)(?:\s+(?:prompt|entry|request))?$|^enter(?:\s+the)?\s+password$/;

/** A short spoken approval command, or null for anything that should go to the agent. */
export function spokenApproval(transcript: string): SpokenApproval | null {
  const text = transcript.toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!text || text.split(" ").length > 6) return null;
  if (ALLOW.test(text)) return "allow";
  if (DENY.test(text)) return "deny";
  if (OPEN.test(text)) return "open";
  return null;
}
