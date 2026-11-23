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
export function pendingVoiceApprovals<P extends PendingPermissionLike, S extends PendingSudoLike>(
  records: readonly P[], sudo: readonly S[], now: number, titleOf: (conversationId: string) => string | undefined,
): VoiceApproval<P, S>[] {
  const secrets = sudo.filter(item => now < item.expiresAt).map((request): VoiceApproval<P, S> => ({ kind: "sudo", request }));
  const permissions = records
    .filter(record => (record.phase === "pending" || record.phase === "deciding") && now < record.deadlineAt)
    .sort((a, b) => a.deadlineAt - b.deadlineAt)
    .map((record): VoiceApproval<P, S> => ({
      kind: "permission",
      record,
      title: titleOf(record.conversationId)?.trim() || "an agent",
      allowOptionId: record.options.find(option => option.kind === "allow_once")?.optionId ?? null,
      denyOptionId: record.options.find(option => option.kind === "reject_once")?.optionId ?? null,
      deciding: record.phase === "deciding",
    }));
  return [...secrets, ...permissions];
}

export function pickVoiceApproval<P extends PendingPermissionLike, S extends PendingSudoLike>(
  records: readonly P[], sudo: readonly S[], now: number, titleOf: (conversationId: string) => string | undefined,
): VoiceApproval<P, S> | null {
  return pendingVoiceApprovals(records, sudo, now, titleOf)[0] ?? null;
}

export function voiceApprovalKey(approval: VoiceApproval): string {
  return approval.kind === "sudo" ? `sudo:${approval.request.id}`
    : `permission:${approval.record.turnId}/${approval.record.requestId}`;
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
