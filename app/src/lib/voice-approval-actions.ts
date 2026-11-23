// Wiring for approvals during a live call (DA-058): the caption strip's buttons and spoken
// "allow once" / "deny" / "open sudo" act through the same paths as the chat's Needs OK card and
// the #670 sudo entry. Nothing here grants anything; the bridge's resolution does.
import { useEffect, useState } from "react";
import { bridge, permissionRequests } from "../net/bridge";
import { store } from "../store/app";
import { dropSecretRequest, secretRequests, showSecretRequest } from "../store/secrets";
import type { PermissionRecord } from "../store/permissions";
import type { SecretRequest } from "../../../shared/secret";
import { pendingVoiceApprovals, pickVoiceApproval, spokenApproval, type SpokenApproval, type VoiceApproval } from "./voice-approvals";

export type LiveApproval = VoiceApproval<PermissionRecord, SecretRequest>;

const titleOf = (id: string) => store.get().conversations.find(c => c.id === id)?.title;

function pick(records: Readonly<Record<string, PermissionRecord>>, sudo: readonly SecretRequest[]): LiveApproval | null {
  return pickVoiceApproval(Object.values(records), sudo, Date.now(), titleOf);
}

export function currentVoiceApproval(): LiveApproval | null {
  return pick(permissionRequests.state.get().records, secretRequests.get().open);
}

export function useVoiceApprovals(): LiveApproval[] {
  const records = permissionRequests.state.use(s => s.records);
  const sudo = secretRequests.use(s => s.open);
  store.use(s => s.conversations); // Re-render when a chat title changes.
  const now = Date.now();
  const approvals = pendingVoiceApprovals(Object.values(records), sudo, now, titleOf);
  const next = Math.min(...approvals.map(item => item.kind === "sudo" ? item.request.expiresAt : item.record.deadlineAt));
  const [, tick] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => tick(value => value + 1), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [next]);
  return approvals;
}

/** Act on one approval; returns the line the caption shows, or null when nothing could be done. */
export function actOnVoiceApproval(approval: LiveApproval, action: SpokenApproval): string | null {
  if (approval.kind === "sudo") {
    const { request } = approval;
    if (action === "deny") {
      bridge.send({ type: "secret_cancel", id: request.id });
      dropSecretRequest(request.id);
      return "Declined sudo";
    }
    // A password is needed: allow/open shows the #670 entry over the live call.
    showSecretRequest(request.id);
    return "Opening sudo entry";
  }
  if (approval.deciding || approval.record.error === "disconnected") return null;
  const optionId = action === "allow" ? approval.allowOptionId : action === "deny" ? approval.denyOptionId : null;
  if (!optionId) return null;
  void permissionRequests.decide(approval.record, optionId);
  return `${action === "allow" ? "Allowed once" : "Denied"} · ${approval.title}`;
}

/** Spoken approval command while one is pending: consumed here, never sent to the agent. */
export function interceptSpokenApproval(transcript: string): { line: string; conversationId?: string } | null {
  const action = spokenApproval(transcript);
  if (!action) return null;
  const approval = currentVoiceApproval();
  if (!approval) return null;
  const line = actOnVoiceApproval(approval, action);
  if (!line) return null;
  return { line, conversationId: approval.kind === "permission" ? approval.record.conversationId : undefined };
}
