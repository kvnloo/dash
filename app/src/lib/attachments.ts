// Phone side of attachments: limits, upload to the paired bridge, and the reverse
// "Send to phone" for host files an agent mentions. Pure helpers take their I/O as
// parameters so the unit suite can run them under Bun.
import { executionToken, type AuthSettings } from "./bridge-auth";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TURN,
  parseChatAttachment,
  type ChatAttachment,
} from "../../../shared/protocol";

export { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_TURN };

/** What a picker hands back before upload. `blob` is set on web, where the picker gives a File. */
export interface PickedFile {
  uri: string;
  name: string;
  mime: string;
  size?: number;
  blob?: Blob;
  /** Native bytes read through Expo File, never through RN's URI fetch. */
  bytes?: ArrayBuffer;
}

export type DraftState = "uploading" | "ready" | "error";

/** One chip in the composer. */
export interface DraftAttachment {
  key: string;
  name: string;
  mime: string;
  size?: number;
  uri: string;
  state: DraftState;
  ref?: ChatAttachment;
  error?: string;
}

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const LIMIT_LABEL = formatSize(MAX_ATTACHMENT_BYTES);

/** Why a picked file cannot be attached, or null. Unknown sizes are checked after reading. */
export function rejectReason(file: Pick<PickedFile, "name" | "size">): string | null {
  if (file.size !== undefined && file.size > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is ${formatSize(file.size)}. The limit is ${LIMIT_LABEL} per file.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/** How many more files fit in this turn. */
export function remainingSlots(drafts: readonly DraftAttachment[]): number {
  return Math.max(0, MAX_ATTACHMENTS_PER_TURN - drafts.length);
}

export function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Send is allowed with text or ready files, never while a file is still uploading. */
export function canSendDrafts(text: string, drafts: readonly DraftAttachment[]): boolean {
  if (drafts.some(d => d.state === "uploading")) return false;
  return text.trim().length > 0 || drafts.some(d => d.state === "ready");
}

export function readyRefs(drafts: readonly DraftAttachment[]): ChatAttachment[] {
  return drafts.flatMap(d => (d.state === "ready" && d.ref ? [d.ref] : []));
}

/** A best-effort file name from a URI when the picker gives none. */
export function nameFromUri(uri: string, fallback = "file"): string {
  const last = uri.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1);
  if (!last) return fallback;
  try { return decodeURIComponent(last); } catch { return last; }
}

export function uploadUrl(address: string, name: string): string {
  return `http://${address}/attachments?name=${encodeURIComponent(name)}`;
}

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: Blob | ArrayBuffer | string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; blob(): Promise<Blob> }>;

function errorFrom(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const message = Reflect.get(body, "error") ?? Reflect.get(body, "message");
    if (typeof message === "string" && message) return message;
  }
  if (status === 401) return "The bridge rejected this phone. Pair again.";
  if (status === 413) return `Too large. The limit is ${LIMIT_LABEL} per file.`;
  return `Upload failed (${status}).`;
}

/** Read the picked file and POST it to the bridge with the execution token. */
export async function uploadAttachment(
  settings: { address: string } & AuthSettings,
  file: PickedFile,
  fetchImpl: FetchLike,
): Promise<ChatAttachment> {
  let blob = file.bytes ?? file.blob;
  if (!blob) {
    const source = await fetchImpl(file.uri);
    if (!source.ok) throw new Error("Could not read the selected file. Select it again from Files or Photos.");
    blob = await source.blob();
  }
  const size = blob instanceof ArrayBuffer ? blob.byteLength : blob.size;
  if (file.size !== undefined && file.size !== size) throw new Error("The selected file changed or could not be read completely. Select it again.");
  const tooBig = rejectReason({ name: file.name, size });
  if (tooBig) throw new Error(tooBig);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(uploadUrl(settings.address, file.name), {
      method: "POST",
      headers: { Authorization: `Bearer ${await executionToken(settings)}`, "Content-Type": file.mime || "application/octet-stream" },
      body: blob,
    });
  } catch {
    throw new Error("Could not reach the bridge. Check Tailscale and try again.");
  }
  let body: unknown;
  try { body = await res.json(); } catch { body = undefined; }
  if (!res.ok) throw new Error(errorFrom(body, res.status));
  const ref = parseChatAttachment(body);
  if (!ref) throw new Error("The bridge sent back an unexpected reply.");
  return ref;
}

/** Ask the bridge to push one of its files to this phone with KDE Connect. */
export async function sendToPhone(
  settings: { address: string } & AuthSettings,
  path: string,
  fetchImpl: FetchLike,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetchImpl(`http://${settings.address}/share`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await executionToken(settings)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    const message = typeof body === "object" && body !== null ? Reflect.get(body, "message") : undefined;
    return { ok: res.ok, message: typeof message === "string" ? message : res.ok ? "Sent." : errorFrom(body, res.status) };
  } catch {
    return { ok: false, message: "Could not reach the bridge." };
  }
}

/**
 * Absolute host file paths an agent reply mentions, in order, deduped, at most `max`.
 * A path must start at a word boundary, have at least two segments and end in an extension;
 * URLs and `~`-relative paths are skipped (the phone cannot resolve a remote home).
 */
export function fileRefs(text: string, max = 3): string[] {
  const out: string[] = [];
  const pattern = /(^|[\s`'"(\[<:=])(\/(?:[\w.@+-]+\/)+[\w.@+ -]*?[\w@+-]\.[A-Za-z0-9]{1,8})(?=$|[\s`'")\]>,;:!?]|\.(?:\s|$))/g;
  for (const match of text.matchAll(pattern)) {
    const path = match[2];
    if (!path || path.includes("/./") || path.includes("/../") || out.includes(path)) continue;
    out.push(path);
    if (out.length >= max) break;
  }
  return out;
}

export function baseName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
