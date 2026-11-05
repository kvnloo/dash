// Authenticated, per-request readiness for bridge dictation and native voice.
// This is diagnostic metadata only: never return a bearer, credential, or token.
import { speechAvailable } from "../speech";

export interface VoiceStatus {
  stt: { ok: boolean; reason?: string };
  ffmpeg: boolean;
  nativeVoice: boolean;
  identity: boolean;
  broker: string;
}

/** Return only the broker origin, never credentials, paths, or query parameters. */
function publicBroker(): string {
  try {
    const url = new URL(process.env.DASH_Z0LIVE_BROKER ?? "https://0.taila30dc.ts.net:8791");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

/** Recheck speech on each request, so installing the model needs no bridge restart. */
export function voiceStatus(): VoiceStatus {
  return {
    stt: speechAvailable(),
    ffmpeg: Bun.which("ffmpeg") !== null,
    // Match /voice/bootstrap: enabled by default, explicitly disabled by "0".
    nativeVoice: process.env.DASH_NATIVE_VOICE !== "0",
    identity: process.env.DASH_IDENTITY === "1",
    broker: publicBroker(),
  };
}

export function createVoiceStatusHttpHandler(options: { authorize(request: Request): Promise<boolean> }) {
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/voice/status") return null;
    const headers = { "Cache-Control": "no-store" };
    if (!await options.authorize(request)) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers });
    }
    if (request.method !== "GET") {
      return Response.json({ error: "method not allowed" }, { status: 405, headers });
    }
    return Response.json(voiceStatus(), { headers });
  };
}
