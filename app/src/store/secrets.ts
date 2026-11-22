// Open secure-sudo requests from the bridge (shared/secret.ts). Holds no password: the entry screen
// keeps the typed text in component state only and drops it after sealing.
import { createStore } from "./createStore";
import type { SecretRequest, SecretResolved } from "../../../shared/secret";

/** `shown`: the request the owner chose to open during a live voice call (DA-058). Outside a call the
 * entry opens on its own; during one it waits in the caption strip until tapped or asked for. */
export interface SecretEntryState { open: SecretRequest[]; last: SecretResolved | null; shown: string | null }
export const secretRequests = createStore<SecretEntryState>({ open: [], last: null, shown: null });

export function receiveSecretRequest(request: SecretRequest): void {
  secretRequests.set(s => (s.open.some(r => r.id === request.id) ? s : { ...s, open: [...s.open, request].slice(-4) }));
}
export function receiveSecretResolved(resolved: SecretResolved): void {
  secretRequests.set(s => (s.open.some(r => r.id === resolved.id) ? { ...s, open: s.open.filter(r => r.id !== resolved.id), last: resolved } : s));
}
export function dropSecretRequest(id: string): void {
  secretRequests.set(s => ({ ...s, open: s.open.filter(r => r.id !== id) }));
}
export function showSecretRequest(id: string): void {
  secretRequests.set(s => (s.open.some(r => r.id === id) ? { ...s, shown: id } : s));
}
