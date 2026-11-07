import { parseLiveIntent } from "../../../../shared/live";
import type { LiveIntent } from "../../../../shared/live";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFrameValue(value: unknown): value is LiveIntent["value"] {
  return typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || (Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string"));
}

/** Parse a native artifact WebView message without trusting its declared intent metadata. */
export function parseFrameMessage(
  data: string,
  artifactVersion: number,
  { staticOnly = false }: { staticOnly?: boolean } = {},
): LiveIntent | null {
  if (staticOnly || data.length > 4096) return null;

  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isRecord(message) || ("type" in message && message.type !== "fx-intent") || !isFrameValue(message.value)) {
    return null;
  }

  const label = message.label;
  return parseLiveIntent({
    controlId: message.controlId,
    value: message.value,
    ...(label === undefined ? {} : { label: typeof label === "string" ? label.trim() : label }),
    artifactVersion,
    surface: "dash-live-surface",
  });
}
