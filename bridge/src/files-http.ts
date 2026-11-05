// HTTP routes for files over the authenticated tailnet connection. Both routes need the
// execution token as a bearer header; neither is reachable without it.
//
//   POST /attachments?name=<file name>   body: raw bytes, Content-Type: the file's MIME
//     → { id, name, mime, size }   (the phone sends `id` with its next chat turn)
//   POST /share   { "path": "/abs/path" }
//     → { ok, message }            (owner-initiated KDE Connect push to the phone)
//   POST /transcribe   body: one recorded utterance (any container ffmpeg reads)
//     → { text }                   (speech-to-text only; no turn starts)
import { bearerToken, secretMatches } from "./bridge-security";
import { AttachmentError, type AttachmentStore } from "./attachments";
import { checkShareable, pickDevice, shareToPhone, type Run } from "./share";
import { imagePreview } from "./image-preview";
import { textPreview } from "./text-preview";

export interface FilesHttpOptions {
  token: string;
  authorize?(request: Request): Promise<boolean>;
  store: AttachmentStore;
  shareRoots(): string[];
  device?: string;
  run: Run;
  onEvent?(event: string, fields: Record<string, unknown>): void;
  /** Host STT remains mounted even when dependencies are installed after startup. */
  transcribe?(audio: Uint8Array, id: string): Promise<{ text: string }>;
  speechAvailable?(): { ok: boolean; reason?: string };
}

const MAX_SHARE_JSON = 8 * 1024;
export const MAX_TRANSCRIBE_BYTES = 10 * 1024 * 1024;

export function createFilesHttpHandler(options: FilesHttpOptions) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
  const sttUnavailable = (reason?: string) => json({
    error: "Speech-to-text is not available on this host.",
    reason: reason ?? "Speech-to-text is not configured on this host.",
  }, 503);
  let sharing = false;
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== "/attachments" && url.pathname !== "/share" && url.pathname !== "/files" && url.pathname !== "/transcribe") return null;
    if (!(options.authorize ? await options.authorize(request) : secretMatches(bearerToken(request), options.token))) return json({ error: "unauthorized" }, 401);
    if (url.pathname === "/files") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      try { return await (url.searchParams.get("format") === "text" ? textPreview : imagePreview)(url.searchParams.get("path"), options.shareRoots()); }
      catch { return json({ error: "Image unavailable" }, 404); }
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    if (url.pathname === "/transcribe") {
      const ready = options.speechAvailable?.();
      if (ready && !ready.ok) return sttUnavailable(ready.reason);
      if (!options.transcribe) return sttUnavailable();
      const length = Number(request.headers.get("content-length") ?? "0");
      if (length > MAX_TRANSCRIBE_BYTES) return json({ error: "recording too large" }, 413);
      const audio = new Uint8Array(await request.arrayBuffer());
      if (audio.byteLength === 0) return json({ error: "empty recording" }, 400);
      if (audio.byteLength > MAX_TRANSCRIBE_BYTES) return json({ error: "recording too large" }, 413);
      try {
        const { text } = await options.transcribe(audio, `transcribe-${Date.now().toString(36)}`);
        options.onEvent?.("transcribe.done", { bytes: audio.byteLength, chars: text.length });
        return json({ text });
      } catch (error) {
        const status = options.speechAvailable?.();
        if (status && !status.ok) return sttUnavailable(status.reason);
        if (error instanceof Error && error.name === "SpeechUnavailableError") return sttUnavailable(error.message);
        options.onEvent?.("transcribe.failed", { error: String(error) });
        return json({ error: "Could not transcribe the recording." }, 500);
      }
    }
    if (url.pathname === "/attachments") {
      const name = url.searchParams.get("name") ?? "";
      try {
        const stored = await options.store.upload(request.body, request.headers.get("content-length"), name, request.headers.get("content-type"));
        options.onEvent?.("attachment.stored", { id: stored.id, bytes: stored.size, mime: stored.mime });
        return json(stored);
      } catch (error) {
        if (error instanceof AttachmentError) return json({ error: error.message }, error.status);
        return json({ error: "Could not store the file on the host." }, 500);
      }
    }
    const length = request.headers.get("content-length");
    if (length !== null && Number(length) > MAX_SHARE_JSON) return json({ error: "request too large" }, 413);
    let body: unknown;
    try { body = JSON.parse((await request.text()).slice(0, MAX_SHARE_JSON)); } catch { return json({ error: "invalid JSON" }, 400); }
    const raw = typeof body === "object" && body !== null ? Reflect.get(body, "path") : undefined;
    const check = checkShareable(raw, options.shareRoots());
    if (!check.ok) return json({ ok: false, message: check.message }, check.status);
    if (sharing) return json({ ok: false, message: "Another file is being sent. Try again in a moment." }, 429);
    sharing = true;
    try {
      const device = await pickDevice(options.device, options.run);
      if (!device) return json({ ok: false, message: "No single paired KDE Connect phone is reachable from the host." }, 503);
      const result = await shareToPhone(check.path, device, options.run);
      options.onEvent?.("share.sent", { ok: result.ok, bytes: check.size });
      return json(result, result.ok ? 200 : 502);
    } finally { sharing = false; }
  };
}
