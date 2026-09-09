/** Ephemeral pairing sessions — short codes instead of typing the master token. */

import { createHash, timingSafeEqual } from "node:crypto";

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TTL_MS = 3 * 60 * 1000;
const MAX_SESSIONS = 3;
const CLAIM_KEY_BYTES = 32;

export interface PairSession {
  id: string;
  code: string;
  expiresAt: number;
  /** When set, `/pair/claim` must present the matching raw claim key (never sent over audio). */
  claimKeyHash?: Buffer;
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const b of bytes) out += CHARSET[b % CHARSET.length];
  return out;
}

const sessions = new Map<string, PairSession>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(id);
  }
}

function trimSessions(): void {
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (!oldest) break;
    sessions.delete(oldest[0]);
  }
}

export function hashClaimKey(claimKey: Uint8Array): Buffer {
  if (claimKey.length !== CLAIM_KEY_BYTES) {
    throw new Error(`claim key must be ${CLAIM_KEY_BYTES} bytes`);
  }
  return createHash("sha256").update(claimKey).digest();
}

/** Display / curl beep — code-only claim (weaker; for terminal fallback). */
export function currentOrCreateSession(): PairSession {
  purgeExpired();
  const active = [...sessions.values()].sort((a, b) => b.expiresAt - a.expiresAt)[0];
  if (active) return active;
  trimSessions();
  const session: PairSession = {
    id: crypto.randomUUID(),
    code: randomCode(),
    expiresAt: Date.now() + TTL_MS,
  };
  sessions.set(session.id, session);
  return session;
}

/** Sonic pairing — binds this session to a phone-only secret sent over Tailscale. */
export function startBoundSession(claimKey: Uint8Array): PairSession {
  purgeExpired();
  trimSessions();
  const session: PairSession = {
    id: crypto.randomUUID(),
    code: randomCode(),
    expiresAt: Date.now() + TTL_MS,
    claimKeyHash: hashClaimKey(claimKey),
  };
  sessions.set(session.id, session);
  return session;
}

export function claimSession(code: string, claimKey?: Uint8Array): PairSession | null {
  purgeExpired();
  const normalized = code.trim().toUpperCase();
  for (const session of sessions.values()) {
    if (session.code !== normalized || session.expiresAt <= Date.now()) continue;
    if (session.claimKeyHash) {
      if (!claimKey || claimKey.length !== CLAIM_KEY_BYTES) return null;
      const hash = hashClaimKey(claimKey);
      if (hash.length !== session.claimKeyHash.length || !timingSafeEqual(hash, session.claimKeyHash)) {
        return null;
      }
    }
    sessions.delete(session.id);
    return session;
  }
  return null;
}

export function codeCharIndex(ch: string): number {
  return CHARSET.indexOf(ch.toUpperCase());
}

export { CHARSET as PAIR_CHARSET, CLAIM_KEY_BYTES };
