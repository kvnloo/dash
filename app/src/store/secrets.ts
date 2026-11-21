// Open secure-sudo requests from the bridge (shared/secret.ts). Holds no password: the entry screen
// keeps the typed text in component state only and drops it after sealing.
import { createStore } from "./createStore";
import type { SecretRequest, SecretResolved } from "../../../shared/secret";

export interface SecretEntryState { open: SecretRequest[]; last: SecretResolved | null }
export const secretRequests = createStore<SecretEntryState>({ open: [], last: null });

export function receiveSecretRequest(request: SecretRequest): void {
  secretRequests.set(s => (s.open.some(r => r.id === request.id) ? s : { ...s, open: [...s.open, request].slice(-4) }));
}
export function receiveSecretResolved(resolved: SecretResolved): void {
  secretRequests.set(s => (s.open.some(r => r.id === resolved.id) ? { open: s.open.filter(r => r.id !== resolved.id), last: resolved } : s));
}
export function dropSecretRequest(id: string): void {
  secretRequests.set(s => ({ ...s, open: s.open.filter(r => r.id !== id) }));
}
