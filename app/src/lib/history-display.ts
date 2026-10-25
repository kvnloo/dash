/**
 * Hermes persists mid-turn steering as a user row with a trusted control envelope.
 * This is a display-only projection: never apply it to the outbound send or bridge wire.
 * Source: NousResearch/hermes-agent, agent/prompt_builder.py::format_steer_marker.
 */
const STEER_OPEN = "[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]";
const STEER_CLOSE = "[/OUT-OF-BAND USER MESSAGE]";

/** Unwrap only a complete, exact Hermes steering envelope. Keep other text byte-for-byte. */
export function unwrapHermesHistoryText(text: string): string {
  // The canonical history row strips the two newlines emitted by Hermes' formatter,
  // but older history paths may retain them.
  const candidate = text.startsWith("\n\n") ? text.slice(2) : text;
  const open = `${STEER_OPEN}\n`;
  const close = `\n${STEER_CLOSE}`;
  if (!candidate.startsWith(open) || !candidate.endsWith(close)) return text;
  return candidate.slice(open.length, candidate.length - close.length);
}
