/**
 * Secure sudo entry (#559/#560). Additive, dependency-free wire messages shared by app and bridge.
 *
 * Flow: an agent on the host runs `dash-sudo <command…>`. The bridge (not the agent) owns the
 * request: it mints a per-request X25519 key pair and sends `secret_request` (command, user@host,
 * public key) to the phone. The phone seals the password to that key (X25519 → HKDF-SHA256 →
 * AES-256-GCM, AAD = request id) and returns `secret_submit`. The bridge opens it in memory, writes
 * it only into `sudo -k -S`'s stdin pipe, wipes it, and returns the command's output to the agent.
 * The agent never sees the password; no message, log line or receipt carries it in clear.
 */
export const SECRET_WIRE_VERSION = 1;
export const SECRET_SEAL_INFO = "dash-secret/v1";
export const MAX_SECRET_BYTES = 1024;
export const MAX_SECRET_COMMAND = 400;
export const MAX_SECRET_REASON = 240;
/** base64 of 32 raw bytes (X25519 public key) / 12-byte nonce / ciphertext + 16-byte tag. */
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

export interface SecretRequest {
  type: "secret_request";
  id: string;
  kind: "sudo";
  /** The exact command sudo will run, shell-quoted for display. */
  command: string;
  /** user@host sudo authenticates. */
  account: string;
  /** Optional agent-supplied reason (display only). */
  reason?: string;
  /** Bridge's per-request X25519 public key, base64 (32 bytes). */
  publicKey: string;
  /** Absolute epoch ms. */
  expiresAt: number;
}

export interface SecretSubmit {
  type: "secret_submit";
  id: string;
  /** Phone's ephemeral X25519 public key, base64 (32 bytes). */
  ephemeralKey: string;
  /** AES-GCM nonce, base64 (12 bytes). */
  nonce: string;
  /** AES-256-GCM ciphertext with its 16-byte tag appended, base64. */
  ciphertext: string;
}

export interface SecretCancel { type: "secret_cancel"; id: string }

export type SecretOutcome = "delivered" | "cancelled" | "expired" | "refused" | "failed";
export interface SecretResolved { type: "secret_resolved"; id: string; outcome: SecretOutcome; message?: string }

function rec(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function b64Bytes(v: unknown, min: number, max: number): v is string {
  if (typeof v !== "string" || !B64.test(v) || v.length % 4 !== 0) return false;
  const bytes = (v.length / 4) * 3 - (v.endsWith("==") ? 2 : v.endsWith("=") ? 1 : 0);
  return bytes >= min && bytes <= max;
}
function text(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max && !CONTROL.test(v);
}

export function parseSecretRequest(raw: unknown): SecretRequest | null {
  if (!rec(raw) || raw.type !== "secret_request" || typeof raw.id !== "string" || !ID.test(raw.id) || raw.kind !== "sudo" ||
    !text(raw.command, MAX_SECRET_COMMAND) || !text(raw.account, 200) || !b64Bytes(raw.publicKey, 32, 32) ||
    typeof raw.expiresAt !== "number" || !Number.isFinite(raw.expiresAt) || raw.expiresAt <= 0) return null;
  if (raw.reason !== undefined && !text(raw.reason, MAX_SECRET_REASON)) return null;
  return { type: "secret_request", id: raw.id, kind: "sudo", command: raw.command, account: raw.account,
    ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}), publicKey: raw.publicKey, expiresAt: raw.expiresAt };
}

export function parseSecretSubmit(raw: unknown): SecretSubmit | null {
  if (!rec(raw) || raw.type !== "secret_submit" || typeof raw.id !== "string" || !ID.test(raw.id) ||
    !b64Bytes(raw.ephemeralKey, 32, 32) || !b64Bytes(raw.nonce, 12, 12) || !b64Bytes(raw.ciphertext, 17, MAX_SECRET_BYTES + 16)) return null;
  return { type: "secret_submit", id: raw.id, ephemeralKey: raw.ephemeralKey, nonce: raw.nonce, ciphertext: raw.ciphertext };
}

export function parseSecretCancel(raw: unknown): SecretCancel | null {
  return rec(raw) && raw.type === "secret_cancel" && typeof raw.id === "string" && ID.test(raw.id) ? { type: "secret_cancel", id: raw.id } : null;
}

export function parseSecretResolved(raw: unknown): SecretResolved | null {
  if (!rec(raw) || raw.type !== "secret_resolved" || typeof raw.id !== "string" || !ID.test(raw.id)) return null;
  const outcome = raw.outcome;
  if (outcome !== "delivered" && outcome !== "cancelled" && outcome !== "expired" && outcome !== "refused" && outcome !== "failed") return null;
  if (raw.message !== undefined && !text(raw.message, 240)) return null;
  return { type: "secret_resolved", id: raw.id, outcome, ...(typeof raw.message === "string" ? { message: raw.message } : {}) };
}

/** AAD binds a sealed secret to one request; the HKDF salt binds it to both public keys. */
export function secretAad(id: string): string { return `${SECRET_SEAL_INFO}|${id}`; }
