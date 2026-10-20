// Phone → host attachments. The phone uploads raw bytes with `POST /attachments`
// over the authenticated tailnet connection; the bridge keeps them in a private
// directory and hands absolute paths (and, where a harness supports it, image
// blocks) to the turn. The phone never names a host path.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ATTACHMENT_ID, MAX_ATTACHMENT_BYTES, type ChatAttachment } from "../../shared/protocol";

export { MAX_ATTACHMENT_BYTES };

/** Uploads that never became part of a turn are removed after this long. */
export const STAGING_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_NAME_LENGTH = 120;

/** A stored attachment, claimed by one turn. `path` is absolute on this host. */
export interface StoredAttachment extends ChatAttachment {
  path: string;
}

export class AttachmentError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/**
 * A safe single path component: no separators, no control characters, no leading dot,
 * bounded length with the extension kept. Never empty, never "." or "..".
 */
export function sanitizeFileName(raw: string): string {
  const leaf = raw.split(/[\\/]/).pop() ?? "";
  let name = leaf
    .normalize("NFC")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._ ()+,@=-]/gu, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .trim()
    .replace(/^[.\s]+/, "");
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = `${name.slice(0, MAX_NAME_LENGTH - ext.length).trimEnd()}${ext}`;
  }
  return name.length > 0 ? name : "file";
}

/** `type/subtype` or octet-stream. Parameters (`; charset=…`) are dropped. */
export function sanitizeMime(raw: string | null | undefined): string {
  const value = (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(value) && value.length <= 100 ? value : "application/octet-stream";
}

/** Turn ids are client-chosen; the directory name derived from one must stay a plain component. */
export function turnDirName(turnId: string): string {
  const safe = turnId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return safe.length > 0 && !/^_+$/.test(safe) ? safe : "turn";
}

export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|heic|heif)$/.test(mime);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The text every harness receives. CLI and API harnesses read files from disk with their own
 * tools, so absolute paths are the portable contract. ACP adds native blocks on top.
 */
export function promptWithAttachments(text: string, files: readonly StoredAttachment[]): string {
  if (files.length === 0) return text;
  const lines = files.map(f => `- ${f.path} (${f.mime}, ${formatBytes(f.size)})`);
  const body = text.trim() ? text : "Please look at the attached file" + (files.length === 1 ? "." : "s.");
  return `${body}\n\n[Attached from the Dash phone app. Saved on this host:]\n${lines.join("\n")}\nOpen them from disk with your file or image tools.`;
}

interface Meta { name: string; mime: string; size: number; createdAt: number }

function parseMeta(raw: unknown): Meta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const name = Reflect.get(raw, "name");
  const mime = Reflect.get(raw, "mime");
  const size = Reflect.get(raw, "size");
  const createdAt = Reflect.get(raw, "createdAt");
  if (typeof name !== "string" || typeof mime !== "string" || typeof size !== "number" || typeof createdAt !== "number") return null;
  return { name, mime, size, createdAt };
}

function privateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

/** Files live at `<root>/staging/<id>/` until a turn claims them into `<root>/<turn>/`. */
export class AttachmentStore {
  readonly root: string;
  private readonly staging: string;

  constructor(root: string, private readonly now: () => number = Date.now) {
    this.root = resolve(root);
    this.staging = join(this.root, "staging");
  }

  private ensure(): void {
    privateDir(this.root);
    privateDir(this.staging);
  }

  /** Read at most MAX_ATTACHMENT_BYTES from a request body, then store it. */
  async upload(body: ReadableStream<Uint8Array> | null, declaredLength: string | null, rawName: string, rawMime: string | null): Promise<ChatAttachment> {
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_ATTACHMENT_BYTES)) {
      throw new AttachmentError(413, `File is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
    }
    if (!body) throw new AttachmentError(400, "Missing file body.");
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_ATTACHMENT_BYTES) {
          void reader.cancel();
          throw new AttachmentError(413, `File is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return this.put(rawName, rawMime, Buffer.concat(chunks));
  }

  put(rawName: string, rawMime: string | null, data: Uint8Array): ChatAttachment {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentError(413, `File is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
    this.ensure();
    this.prune();
    const id = randomBytes(16).toString("hex");
    const name = sanitizeFileName(rawName);
    const mime = sanitizeMime(rawMime);
    const dir = join(this.staging, id);
    privateDir(dir);
    writeFileSync(join(dir, name), data, { mode: 0o600 });
    const meta: Meta = { name, mime, size: data.byteLength, createdAt: this.now() };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta), { mode: 0o600 });
    return { id, name, mime, size: data.byteLength };
  }

  /**
   * Move uploads into the turn's own directory and return their absolute paths. Unknown or
   * already-claimed ids fail the whole turn; nothing is half-claimed.
   */
  claim(turnId: string, refs: readonly ChatAttachment[]): StoredAttachment[] {
    const found: { id: string; dir: string; meta: Meta }[] = [];
    for (const ref of refs) {
      if (!ATTACHMENT_ID.test(ref.id)) throw new AttachmentError(400, "Invalid attachment id.");
      const dir = join(this.staging, ref.id);
      let meta: Meta | null = null;
      try { meta = parseMeta(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"))); } catch { meta = null; }
      if (!meta || !existsSync(join(dir, meta.name))) {
        throw new AttachmentError(404, `Attachment "${ref.name}" is no longer on the host. Attach it again.`);
      }
      found.push({ id: ref.id, dir, meta });
    }
    if (found.length === 0) return [];
    const turnDir = join(this.root, turnDirName(turnId));
    privateDir(turnDir);
    const out: StoredAttachment[] = [];
    const used = new Set(existsSync(turnDir) ? readdirSync(turnDir) : []);
    for (const { id, dir, meta } of found) {
      const name = uniqueName(meta.name, used);
      used.add(name);
      const path = join(turnDir, name);
      renameSync(join(dir, meta.name), path);
      chmodSync(path, 0o600);
      rmSync(dir, { recursive: true, force: true });
      out.push({ id, name, mime: meta.mime, size: meta.size, path });
    }
    return out;
  }

  /** Drop staged uploads older than the TTL. Claimed turn files stay until the owner deletes them. */
  prune(): number {
    if (!existsSync(this.staging)) return 0;
    let removed = 0;
    for (const entry of readdirSync(this.staging)) {
      const dir = join(this.staging, entry);
      let created = 0;
      try { created = parseMeta(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")))?.createdAt ?? statSync(dir).mtimeMs; }
      catch { try { created = statSync(dir).mtimeMs; } catch { continue; } }
      if (this.now() - created > STAGING_TTL_MS) {
        rmSync(dir, { recursive: true, force: true });
        removed += 1;
      }
    }
    return removed;
  }
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) {
    const next = `${stem} (${i})${ext}`;
    if (!used.has(next)) return next;
  }
}
