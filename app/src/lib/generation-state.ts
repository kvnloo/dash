/** Incomplete UI payloads must never fall through to the raw source renderer. */
export function generationState(language: string, streaming: boolean, valid: boolean): "loading" | "invalid" | "ready" | "code" {
  if (language !== "genui" && language !== "openui") return "code";
  if (valid) return "ready";
  return streaming ? "loading" : "invalid";
}
