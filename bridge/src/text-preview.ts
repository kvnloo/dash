import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { checkShareable } from "./share";
import { redactTool } from "../../shared/tool-format";
export async function textPreview(raw: string | null, roots: string[]): Promise<Response> {
  const check = checkShareable(raw, roots);
  if (!check.ok) return new Response(check.message, { status: check.status });
  const max = 1024 * 1024;
  if (check.size > max) return new Response("Text file exceeds 1 MiB", { status: 413 });
  const handle = await open(check.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > max) return new Response("Text file exceeds 1 MiB", { status: 413 });
    const bytes = Buffer.alloc(max + 1); const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > max) return new Response("Text file exceeds 1 MiB", { status: 413 });
    const text = bytes.subarray(0, bytesRead).toString("utf8");
    if (text.includes("\0") || text.includes("\ufffd")) return new Response("Not a UTF-8 text file", { status: 415 });
    return new Response(redactTool(text), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } finally { await handle.close(); }
}
