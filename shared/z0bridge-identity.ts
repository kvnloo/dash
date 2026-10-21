/** Dependency-free boundary helpers shared with Expo (no Node or WebCrypto requirement). */
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface IdentityKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid: string;
  alg: "ES256";
  use: "sig";
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function base64url(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) { bits -= 6; out += B64[(value >>> bits) & 63]; }
  }
  if (bits) out += B64[(value << (6 - bits)) & 63];
  return out;
}

// SHA-256 for the ASCII RFC 7638 canonical JWK. Expo Go lacks crypto.subtle.
export function sha256Ascii(text: string): Uint8Array {
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes = new Uint8Array(Math.ceil((text.length + 9) / 64) * 64);
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) throw new Error("ASCII input required");
    bytes[i] = text.charCodeAt(i);
  }
  bytes[text.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 4, text.length * 8);
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Int32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!; const b = w[i - 2]!;
      w[i] = w[i - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let [a = 0,b = 0,c = 0,d = 0,e = 0,f = 0,g = 0,j = 0] = h;
    for (let i = 0; i < 64; i++) {
      const t = (j + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i]! + w[i]!) | 0;
      const u = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      j = g; g = f; f = e; e = (d + t) | 0; d = c; c = b; b = a; a = (t + u) | 0;
    }
    for (const [i, value] of [a,b,c,d,e,f,g,j].entries()) h[i] = (h[i]! + value) | 0;
  }
  const result = new Uint8Array(32);
  const output = new DataView(result.buffer);
  h.forEach((value, i) => output.setInt32(i * 4, value));
  return result;
}

export function pinnedKey(jwks: unknown, kid: string): IdentityKey | undefined {
  if (!record(jwks) || !Array.isArray(jwks.keys) || !/^[A-Za-z0-9_-]{43}$/.test(kid)) return undefined;
  for (const key of jwks.keys) {
    if (!record(key) || key.kty !== "EC" || key.crv !== "P-256" || key.alg !== "ES256" || key.use !== "sig" || key.kid !== kid ||
        typeof key.x !== "string" || typeof key.y !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(key.x) || !/^[A-Za-z0-9_-]{43}$/.test(key.y) || "d" in key) continue;
    const hash = base64url(sha256Ascii(`{"crv":"P-256","kty":"EC","x":"${key.x}","y":"${key.y}"}`));
    if (hash === kid) return { kty: "EC", crv: "P-256", x: key.x, y: key.y, kid, alg: "ES256", use: "sig" };
  }
  return undefined;
}

export function identityUrl(raw: string, loopback = false): string | undefined {
  // Literal addresses only: no redirects, DNS rebinding, userinfo, paths or query.
  const match = /^http:\/\/(\d+\.\d+\.\d+\.\d+):(\d{1,5})\/?$/.exec(raw);
  if (!match) return undefined;
  const host = match[1]!;
  const octets = host.split(".").map(Number);
  if (octets.some(n => n > 255) || octets.join(".") !== host || Number(match[2]) < 1 || Number(match[2]) > 65535) return undefined;
  if (loopback ? host !== "127.0.0.1" : octets[0] !== 100 || octets[1]! < 64 || octets[1]! > 127) return undefined;
  return raw.replace(/\/$/, "");
}

export interface IdentityPairLink { url: string; code: string; kid: string; app: "dash" }
export function parseIdentityPairLink(raw: string): IdentityPairLink | null {
  // z0bridge PR #2 emits ://pair; accept the issue's ://connect spelling too.
  if (!/^dash:\/\/(pair|connect)\?/.test(raw) || raw.includes("#")) return null;
  const params = new Map<string, string>();
  try {
    for (const entry of raw.slice(raw.indexOf("?") + 1).split("&")) {
      const cut = entry.indexOf("=");
      if (cut < 0) return null;
      const key = decodeURIComponent(entry.slice(0, cut));
      if (params.has(key)) return null;
      params.set(key, decodeURIComponent(entry.slice(cut + 1).replace(/\+/g, " ")));
    }
  } catch { return null; }
  const url = identityUrl(params.get("url") ?? "");
  const code = params.get("code"); const kid = params.get("kid");
  if (params.get("v") !== "2" || params.get("app") !== "dash" || !url || !code || !/^z0bp_[A-Za-z0-9_-]{43}$/.test(code) || !kid || !/^[A-Za-z0-9_-]{43}$/.test(kid)) return null;
  return { url, code, kid, app: "dash" };
}
