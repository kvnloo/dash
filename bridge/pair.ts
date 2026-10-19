/** Ephemeral pairing sessions. Bootstrap authentication is enforced by the HTTP boundary. */
import { createHash, timingSafeEqual } from "node:crypto";

const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TTL_MS = 3 * 60 * 1000;
const MAX_SESSIONS = 3;
const CLAIM_KEY_BYTES = 32;

export interface PairSession {
  id: string;
  code: string;
  expiresAt: number;
  claimKeyHash?: Buffer;
}

export interface PairingSessions {
  currentOrCreateSession(): PairSession;
  startBoundSession(claimKey: Uint8Array): PairSession;
  claimSession(code: string, claimKey?: Uint8Array): PairSession | null;
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (const byte of bytes) out += CHARSET[byte % CHARSET.length];
  return out;
}

export function hashClaimKey(claimKey: Uint8Array): Buffer {
  if (claimKey.length !== CLAIM_KEY_BYTES) throw new Error(`claim key must be ${CLAIM_KEY_BYTES} bytes`);
  return createHash("sha256").update(claimKey).digest();
}

export function createPairingSessions(): PairingSessions {
  const sessions = new Map<string, PairSession>();

  function purgeExpired(): void {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id);
    }
  }

  function create(claimKeyHash?: Buffer): PairSession {
    purgeExpired();
    while (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.values()].sort((a, b) => a.expiresAt - b.expiresAt)[0];
      if (oldest) sessions.delete(oldest.id);
    }
    let code = randomCode();
    while ([...sessions.values()].some((session) => session.code === code)) code = randomCode();
    const session: PairSession = { id: crypto.randomUUID(), code, expiresAt: Date.now() + TTL_MS, claimKeyHash };
    sessions.set(session.id, session);
    return session;
  }

  function currentOrCreateSession(): PairSession {
    purgeExpired();
    const active = [...sessions.values()]
      .filter((session) => session.claimKeyHash === undefined)
      .sort((a, b) => b.expiresAt - a.expiresAt)[0];
    return active ?? create();
  }

  function startBoundSession(claimKey: Uint8Array): PairSession {
    return create(hashClaimKey(claimKey));
  }

  function claimSession(code: string, claimKey?: Uint8Array): PairSession | null {
    purgeExpired();
    const normalized = code.trim().toUpperCase();
    if (normalized.length !== 6) return null;
    for (const session of sessions.values()) {
      if (session.code !== normalized) continue;
      if (session.claimKeyHash) {
        if (!claimKey || claimKey.length !== CLAIM_KEY_BYTES) return null;
        if (!timingSafeEqual(hashClaimKey(claimKey), session.claimKeyHash)) return null;
      }
      sessions.delete(session.id);
      return session;
    }
    return null;
  }

  return { currentOrCreateSession, startBoundSession, claimSession };
}

const defaultSessions = createPairingSessions();
export const currentOrCreateSession = defaultSessions.currentOrCreateSession;
export const startBoundSession = defaultSessions.startBoundSession;
export const claimSession = defaultSessions.claimSession;

export function codeCharIndex(ch: string): number {
  return CHARSET.indexOf(ch.toUpperCase());
}

export { CHARSET as PAIR_CHARSET, CLAIM_KEY_BYTES };
