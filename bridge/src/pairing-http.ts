import type { HarnessInfo } from "../../shared/protocol";
import { CLAIM_KEY_BYTES, type PairingSessions } from "../pair";
import { bearerToken, secretMatches } from "./bridge-security";

export const MAX_PAIR_AUDIO_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_AUDIO_JSON_BYTES = Math.ceil(MAX_PAIR_AUDIO_BYTES / 3) * 4 + 1024;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_CLIENTS = 1024;

export interface PairingHttpOptions {
  bootstrapToken: string;
  token: string;
  hostname: string;
  address: string;
  cwd: string;
  harnesses(): HarnessInfo[];
  roster(): unknown;
  pairing: PairingSessions;
  playCode(code: string): void;
  decodeAudio(audio: Uint8Array): Promise<string | null>;
  rateLimit?: number;
  onEvent?(event: string, fields: { session: string }): void;
}

class BodyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new BodyError(413, "request too large");
  }
  if (!request.body) throw new BodyError(400, "missing JSON body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel();
        throw new BodyError(413, "request too large");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new BodyError(400, "invalid JSON"); }
}

function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null || !(key in body)) return undefined;
  const value = Object.getOwnPropertyDescriptor(body, key)?.value;
  return typeof value === "string" ? value : undefined;
}

function decodeClaimKey(raw: string | undefined): Uint8Array {
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new BodyError(400, "invalid claim key");
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length !== CLAIM_KEY_BYTES || bytes.toString("base64url") !== raw) throw new BodyError(400, "invalid claim key");
  return new Uint8Array(bytes);
}

function decodeAudio(raw: string | undefined): Uint8Array {
  if (!raw) throw new BodyError(400, "missing audio");
  if (raw.length > Math.ceil(MAX_PAIR_AUDIO_BYTES / 3) * 4) throw new BodyError(413, "audio too large");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) throw new BodyError(400, "invalid audio");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length > MAX_PAIR_AUDIO_BYTES) throw new BodyError(413, "audio too large");
  if (!bytes.length || bytes.toString("base64") !== raw) throw new BodyError(400, "invalid audio");
  return new Uint8Array(bytes);
}

export function createPairingHttpHandler(options: PairingHttpOptions) {
  if (!options.bootstrapToken || !options.token || secretMatches(options.bootstrapToken, options.token)) {
    throw new Error("Pairing requires distinct bootstrap and execution credentials.");
  }
  const requests = new Map<string, { count: number; resetAt: number }>();
  let decoding = false;
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const unauthorized = () => json({ error: "unauthorized" }, 401);

  function rateLimited(remote: string): boolean {
    const now = Date.now();
    for (const [address, entry] of requests) {
      if (entry.resetAt <= now) requests.delete(address);
    }
    let entry = requests.get(remote);
    if (!entry) {
      if (requests.size >= MAX_RATE_CLIENTS) return true;
      entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
      requests.set(remote, entry);
    }
    entry.count += 1;
    return entry.count > (options.rateLimit ?? 12);
  }

  function credentials() {
    return { address: options.address, token: options.token, host: options.hostname, cwd: options.cwd, harnesses: options.harnesses() };
  }

  return async (request: Request, remote: string | null): Promise<Response | null> => {
    const url = new URL(request.url);
    const pairRoute = url.pathname === "/pair" || url.pathname.startsWith("/pair/");
    if (!pairRoute && url.pathname !== "/" && url.pathname !== "/roster") return null;
    if (!remote) return json({ error: "remote address unavailable" }, 403);
    if ((pairRoute || url.pathname === "/") && rateLimited(remote)) return json({ error: "too many attempts" }, 429);
    const bearer = bearerToken(request);
    if (pairRoute && !secretMatches(bearer, options.bootstrapToken)) return unauthorized();
    if (url.pathname === "/") {
      if (!secretMatches(bearer, options.bootstrapToken) && !secretMatches(bearer, options.token)) return unauthorized();
      return json({ ok: true, host: options.hostname, cwd: options.cwd, harnesses: options.harnesses(), pair: "/pair" });
    }
    if (url.pathname === "/roster") {
      if (!secretMatches(bearer ?? url.searchParams.get("token"), options.token)) return unauthorized();
      return json({ host: options.hostname, hosts: await options.roster() });
    }
    try {
      if (url.pathname === "/pair" && request.method === "GET") {
        const session = options.pairing.currentOrCreateSession();
        return json({ code: session.code, host: options.hostname, address: options.address, port: Number(new URL(`http://${options.address}`).port), expiresAt: session.expiresAt, link: `dash://connect?address=${encodeURIComponent(options.address)}&code=${encodeURIComponent(session.code)}` });
      }
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (url.pathname === "/pair/beep") {
        const session = options.pairing.currentOrCreateSession();
        options.playCode(session.code);
        options.onEvent?.("pair.beep", { session: session.id });
        return json({ ok: true, expiresAt: session.expiresAt, host: options.hostname, address: options.address });
      }
      if (url.pathname === "/pair/intent") {
        const body = await readJson(request, MAX_JSON_BYTES);
        const session = options.pairing.startBoundSession(decodeClaimKey(stringField(body, "claimKey")));
        options.playCode(session.code);
        options.onEvent?.("pair.intent", { session: session.id });
        return json({ ok: true, expiresAt: session.expiresAt, host: options.hostname, address: options.address });
      }
      if (url.pathname === "/pair/claim") {
        const body = await readJson(request, MAX_JSON_BYTES);
        const code = stringField(body, "code") ?? "";
        const rawKey = stringField(body, "claimKey");
        const claimKey = rawKey === undefined ? undefined : decodeClaimKey(rawKey);
        const session = options.pairing.claimSession(code, claimKey);
        if (!session) return json({ error: "invalid or expired code" }, 401);
        options.onEvent?.("pair.claim", { session: session.id });
        return json(credentials());
      }
      if (url.pathname === "/pair/hear") {
        if (decoding) return json({ error: "audio decoder busy" }, 429);
        decoding = true;
        try {
          const body = await readJson(request, MAX_AUDIO_JSON_BYTES);
          const claimKey = decodeClaimKey(stringField(body, "claimKey"));
          const audio = decodeAudio(stringField(body, "audio"));
          const code = await options.decodeAudio(audio);
          if (!code) return json({ error: "could not hear pairing tones" }, 422);
          const session = options.pairing.claimSession(code, claimKey);
          if (!session) return json({ error: "invalid or expired code" }, 401);
          options.onEvent?.("pair.hear", { session: session.id });
          return json(credentials());
        } finally { decoding = false; }
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof BodyError) return json({ error: error.message }, error.status);
      return json({ error: "pairing failed" }, 500);
    }
  };
}
