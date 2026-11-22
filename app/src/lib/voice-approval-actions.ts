// Wiring for approvals during a live call (DA-058): the caption strip's buttons and spoken
// "allow once" / "deny" / "open sudo" act through the same paths as the chat's Needs OK card and
// the #670 sudo entry. Nothing here grants anything; the bridge's resolution does.
import { bridge, permissionRequests } from "../net/bridge";
import { store } from "../store/app";
import { dropSecretRequest, secretRequests, showSecretRequest } from "../store/secrets";
import type { PermissionRecord } from "../store/permissions";
import type { SecretRequest } from "../../../shared/secret";
import { pickVoiceApproval, spokenApproval, type SpokenApproval, type VoiceApproval } from "./voice-approvals";

export type LiveApproval = VoiceApproval<PermissionRecord, SecretRequest>;

const titleOf = (id: string) => store.get().conversations.find(c => c.id === id)?.title;

function pick(records: Readonly<Record<string, PermissionRecord>>, sudo: readonly SecretRequest[]): LiveApproval | null {
  return pickVoiceApproval(Object.values(records), sudo, Date.now(), titleOf);
}

export function currentVoiceApproval(): LiveApproval | null {
  return pick(permissionRequests.state.get().records, secretRequests.get().open);
}

export function useVoiceApproval(): LiveApproval | null {
  const records = permissionRequests.state.use(s => s.records);
  const sudo = secretRequests.use(s => s.open);
  store.use(s => s.conversations); // Re-render when a chat title changes.
  return pick(records, sudo);
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
export function interceptSpokenApproval(transcript: string): string | null {
  const action = spokenApproval(transcript);
  if (!action) return null;
  const approval = currentVoiceApproval();
  return approval ? actOnVoiceApproval(approval, action) : null;
}
