import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { checkShareable } from "./share";
export const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
/** Raster bytes only. No SVG/HTML/polyglot document is ever served as an active resource. */
export function rasterMime(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length >= 8 && bytes[0] === 137 && ascii(1, 4) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "image/avif";
  return null;
}
export async function imagePreview(raw: string | null, roots: string[]): Promise<Response> {
  const check = checkShareable(raw, roots);
  if (!check.ok) return new Response(check.message, { status: check.status });
  if (check.size > MAX_PREVIEW_BYTES) return new Response("Image too large", { status: 413 });
  // Open the checked canonical leaf without following a replacement symlink; bound the actual read too.
  const handle = await open(check.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_PREVIEW_BYTES) return new Response("Image too large", { status: 413 });
    const bytes = Buffer.alloc(Math.min(stat.size, MAX_PREVIEW_BYTES) + 1);
    let length = 0;
    while (length < bytes.length) { const part = await handle.read(bytes, length, bytes.length - length, null); if (!part.bytesRead) break; length += part.bytesRead; }
    if (length > MAX_PREVIEW_BYTES) return new Response("Image too large", { status: 413 });
    const image = bytes.subarray(0, length);
    const mime = rasterMime(image);
    if (!mime) return new Response("Only raster images can be previewed", { status: 415 });
    return new Response(image, { headers: { "content-type": mime, "content-length": String(length), "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } finally { await handle.close(); }
}
