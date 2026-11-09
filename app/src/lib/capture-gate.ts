/**
 * Composer decision for bedtime capture-only mode.
 * Mirrors the two policy booleans structurally; this module does not import
 * the host-only interaction policy or perform network/persistence operations.
 */
export interface CaptureOverride {
  /** Absolute expiry (milliseconds since the Unix epoch). */
  readonly until: number;
  /** Grant time makes the 15-minute cap stable across later renders. */
  readonly issuedAt?: number;
}

export interface CaptureGateInput {
  readonly captureMode: boolean;
  readonly captureEnforced: boolean;
  readonly text: string;
  readonly attachments: readonly unknown[];
  readonly isStopAction: boolean;
  readonly override?: CaptureOverride | null;
}

export interface CaptureGate {
  readonly action: "send" | "capture" | "stop";
  readonly label: string;
  readonly enabled: boolean;
  readonly placeholder?: string;
  readonly hint?: string;
}

export const MAX_CAPTURE_OVERRIDE_MS = 15 * 60_000;

/**
 * Mint an explicit Send anyway exception at the moment of user consent.
 * Persist only this bounded token and clear it after the first accepted send.
 */
export function createCaptureOverride(now: number, requestedUntil = now + MAX_CAPTURE_OVERRIDE_MS): CaptureOverride {
  if (!Number.isFinite(now)) return { issuedAt: 0, until: 0 };
  const safeUntil = Number.isFinite(requestedUntil) ? requestedUntil : now;
  return {
    issuedAt: now,
    until: Math.max(now, Math.min(safeUntil, now + MAX_CAPTURE_OVERRIDE_MS)),
  };
}

function hasActiveOverride(override: CaptureOverride | null | undefined, now: number): boolean {
  if (!override || !Number.isFinite(now) || !Number.isFinite(override.until) || override.until <= now) {
    return false;
  }

  // The minimal { until } shape remains supported for already-bounded tokens.
  // Tokens minted here also carry issuedAt to enforce the lifetime at every read.
  if (override.issuedAt === undefined) {
    return override.until <= now + MAX_CAPTURE_OVERRIDE_MS;
  }
  if (!Number.isFinite(override.issuedAt) || override.issuedAt > now) return false;
  return now < Math.min(override.until, override.issuedAt + MAX_CAPTURE_OVERRIDE_MS);
}

/**
 * One primary action, without initiating sends, captures or stops.
 * The clock argument keeps decisions deterministic in tests and callers that
 * pass an explicit timestamp. The default supports existing composer callers.
 */
export function captureGate(input: CaptureGateInput, now = Date.now()): CaptureGate {
  // Stop operates on a running turn; an empty draft must not disable it.
  if (input.isStopAction) return { action: "stop", label: "Stop", enabled: true };

  const enabled = input.text.trim().length > 0 || input.attachments.length > 0;
  if (!input.captureMode) return { action: "send", label: "Send", enabled };
  if (!input.captureEnforced) {
    return { action: "send", label: "Send", enabled, hint: "Bedtime: this will be sent now" };
  }
  if (hasActiveOverride(input.override, now)) {
    return {
      action: "send",
      label: "Send anyway",
      enabled,
      hint: "One-time bedtime exception: this will be sent now",
    };
  }
  return {
    action: "capture",
    label: "Save for tomorrow",
    placeholder: "Capture a thought for tomorrow",
    hint: "Capture-only mode: do not send to agents",
    enabled,
  };
}
