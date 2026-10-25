import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_TURN, type PickedFile } from "./attachments";

export interface IncomingShare { id: string; text: string; files: PickedFile[]; errors: string[] }
export function parseIncomingShare(raw: unknown): IncomingShare | null {
  if (typeof raw !== "object" || raw === null) return null;
  const id: unknown = Reflect.get(raw, "id"), text: unknown = Reflect.get(raw, "text");
  const files: unknown = Reflect.get(raw, "files"), errors: unknown = Reflect.get(raw, "errors");
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id) || typeof text !== "string" || text.length > 60000 || !Array.isArray(files) || files.length > MAX_ATTACHMENTS_PER_TURN || !Array.isArray(errors) || !errors.every((e: unknown) => typeof e === "string")) return null;
  const picked: PickedFile[] = [];
  let total = 0;
  for (const file of files) {
    if (typeof file !== "object" || file === null) return null;
    const uri: unknown = Reflect.get(file, "uri"), name: unknown = Reflect.get(file, "name");
    const mime: unknown = Reflect.get(file, "mime"), size: unknown = Reflect.get(file, "size");
    if (typeof uri !== "string" || !uri.startsWith("file://") || !uri.includes(`/incoming-shares/${id}/`) || uri.includes("/../") || typeof name !== "string" || !name || name.length > 255 || typeof mime !== "string" || typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) return null;
    total += size;
    if (total > 50 * 1024 * 1024) return null;
    picked.push({ uri, name, mime, size });
  }
  return { id, text, files: picked, errors };
}

export function isShareLink(url: string | null): boolean {
  if (!url) return false;
  try { const parsed = new URL(url); return parsed.protocol === "dash:" && parsed.hostname === "expo-sharing"; } catch { return false; }
}
