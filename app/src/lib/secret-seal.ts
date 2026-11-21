// Seal a sudo password to the bridge's per-request key (shared/secret.ts). Pure JS (@noble), no
// native module. Fails closed: without a cryptographically secure random source nothing is sealed.
import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { MAX_SECRET_BYTES, SECRET_SEAL_INFO, secretAad, type SecretRequest, type SecretSubmit } from "../../../shared/secret";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!, b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    out += B64[b0 >> 2]! + B64[((b0 & 3) << 4) | (b1 >> 4)]! + (i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)]! : "=") + (i + 2 < bytes.length ? B64[b2 & 63]! : "=");
  }
  return out;
}
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, value = 0, at = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("bad base64");
    value = (value << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[at++] = (value >> bits) & 0xff; }
  }
  return out;
}

export type RandomSource = (bytes: Uint8Array) => void;
export function secureRandom(): RandomSource | null {
  const source = globalThis.crypto;
  return source && typeof source.getRandomValues === "function" ? bytes => { source.getRandomValues(bytes); } : null;
}

export class SealError extends Error {}

/** Returns the wire message; wipes every intermediate it owns. The caller drops `secret` right after. */
export function sealSecret(request: Pick<SecretRequest, "id" | "publicKey">, secret: string, random: RandomSource | null = secureRandom()): SecretSubmit {
  if (!random) throw new SealError("This build has no secure random source, so it cannot seal a password.");
  const plain = new TextEncoder().encode(secret);
  try {
    if (plain.length === 0) throw new SealError("Enter the password first.");
    if (plain.length > MAX_SECRET_BYTES) throw new SealError("That password is too long.");
    if (plain.includes(0x0a) || plain.includes(0x0d)) throw new SealError("A password cannot contain line breaks.");
    const bridgeKey = fromBase64(request.publicKey);
    if (bridgeKey.length !== 32) throw new SealError("The bridge sent an invalid key.");
    const ephemeralSecret = new Uint8Array(32); random(ephemeralSecret);
    const nonce = new Uint8Array(12); random(nonce);
    const ephemeralKey = x25519.getPublicKey(ephemeralSecret);
    const shared = x25519.getSharedSecret(ephemeralSecret, bridgeKey);
    const salt = new Uint8Array(64); salt.set(ephemeralKey, 0); salt.set(bridgeKey, 32);
    const key = hkdf(sha256, shared, salt, new TextEncoder().encode(SECRET_SEAL_INFO), 32);
    try {
      if (shared.every(byte => byte === 0)) throw new SealError("The bridge sent an invalid key.");
      const ciphertext = gcm(key, nonce, new TextEncoder().encode(secretAad(request.id))).encrypt(plain);
      return { type: "secret_submit", id: request.id, ephemeralKey: toBase64(ephemeralKey), nonce: toBase64(nonce), ciphertext: toBase64(ciphertext) };
    } finally { ephemeralSecret.fill(0); shared.fill(0); key.fill(0); }
  } finally { plain.fill(0); }
}
