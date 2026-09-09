/** 32-byte phone-only secret; never transmitted over audio. */
export const CLAIM_KEY_BYTES = 32;

export function newClaimKey(): Uint8Array {
  const key = new Uint8Array(CLAIM_KEY_BYTES);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(key);
    return key;
  }
  for (let i = 0; i < key.length; i++) key[i] = Math.floor(Math.random() * 256);
  return key;
}

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}

export function claimKeyToBase64Url(key: Uint8Array): string {
  return bytesToBase64(key).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
