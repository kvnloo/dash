export interface VoiceLinker {
  openURL(url: string): Promise<unknown>;
}

export type VoiceLaunchResult =
  | { kind: "opened" }
  | { kind: "unavailable"; message: string };

/** Compatibility entry only. Native callers use the app-root ContinuousVoice controller. */
export async function launchSharedVoice(_platform: string, _linker: VoiceLinker): Promise<VoiceLaunchResult> {
  return { kind: "unavailable", message: "Use native continuous voice inside Dash. Expo Go/web voice is unavailable; no external app is opened." };
}

/** Bootstrap checks never persist credentials or silently fall back to another voice app. */
export const VOICE_BOOTSTRAP_PATH = "/voice/bootstrap";
export interface VoiceBootstrapTarget {
  readonly profile: string;
  readonly session: string;
}
export interface VoiceBootstrapReply {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}
export type VoiceBootstrapRequest = (target: VoiceBootstrapTarget) => Promise<VoiceBootstrapReply>;
export type VoiceBootstrapOutcome =
  | { kind: "ready" }
  | { kind: "error"; reason: string; retryLabel: "Retry" };

function failed(reason: string): VoiceBootstrapOutcome {
  return { kind: "error", reason, retryLabel: "Retry" };
}

function httpFailure(status: number): string {
  if (status === 401) return "Voice authorization expired. Re-pair Dash.";
  if (status === 403) return "Voice permission denied. Check the voice grant.";
  if (status === 404) return "Bridge lacks voice bootstrap. Update bridge.";
  if (status === 503) return "Voice is disabled on this bridge.";
  if (status === 429) return "Voice is busy. Retry shortly.";
  if (status >= 500) return "Voice service unavailable. Retry shortly.";
  if (status === 400 || status === 422) return "Voice target rejected. Attach a Hermes conversation.";
  return "Voice bootstrap refused (HTTP " + status + ").";
}

/**
 * Converts a native authenticated /voice/bootstrap reply into a short, retryable
 * pill state. The caller owns the paired token and HTTP request; error payloads
 * are intentionally not shown (they may contain private server details).
 */
export async function checkVoiceBootstrap(
  target: VoiceBootstrapTarget,
  request: VoiceBootstrapRequest,
): Promise<VoiceBootstrapOutcome> {
  let response: VoiceBootstrapReply;
  try {
    response = await request(target);
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return failed("Voice request timed out. Retry.");
    }
    return failed("Can't reach Dash voice. Check connection.");
  }
  if (!response.ok) return failed(httpFailure(response.status));

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return failed("Voice sent an invalid response.");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) ||
      !("ready" in payload) || payload.ready !== true ||
      !("profile" in payload) || payload.profile !== target.profile ||
      !("session" in payload) || payload.session !== target.session) {
    return failed("Voice could not confirm this conversation.");
  }
  return { kind: "ready" };
}
