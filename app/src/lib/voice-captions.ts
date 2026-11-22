// Pure helpers for the live caption strip (DA-056). No React Native imports.
export interface VoiceCaption { role: "user" | "assistant"; text: string; final: boolean }

// Native clips the head of the line (ellipsizeMode="head"); web clips the tail, so keep it short.
const MAX_SHOWN = 90;

/** One display line: whitespace collapsed, newest words kept when the text is long. */
export function captionText(caption: VoiceCaption | null): string {
  const text = caption?.text.replace(/\s+/g, " ").trim() ?? "";
  if (!text) return "";
  return text.length > MAX_SHOWN ? "…" + text.slice(text.length - MAX_SHOWN + 1) : text;
}

export function captionSpeaker(role: VoiceCaption["role"]): "You" | "Dash" {
  return role === "user" ? "You" : "Dash";
}
