import { memo } from "react";
import { Image } from "react-native";
import { type OrbPreset } from "./orb-html";

/**
 * List avatars use the catalog's silver renders: saturated colour orbs fight the warm gold
 * Living Night palette at 40 px, and the ElevenLabs shader cannot be rendered statically.
 * Full-colour orbs stay on the Voice screen, where the orb is the hero.
 */
const avatars: Record<Exclude<OrbPreset, "elevenlabs">, number> = {
  chatgpt: require("../../assets/orbs/chatgpt-mono.png"),
  gemini: require("../../assets/orbs/gemini-mono.png"),
  siri: require("../../assets/orbs/siri-mono.png"),
  alexa: require("../../assets/orbs/alexa-mono.png"),
  grok: require("../../assets/orbs/grok-mono.png"),
};

export function avatarPresetForHarness(id: string): keyof typeof avatars {
  switch (id) {
    case "hermes": case "codex": return "chatgpt";
    case "claude": return "siri";
    case "omp": return "alexa";
    case "pi": case "fx": return "gemini";
    default: return "grok";
  }
}

/** Small static identity mark. Runtime status is an adjacent truthful dot. */
export const HarnessAvatar = memo(function HarnessAvatar({ name, harnessId, size = 40 }: { name: string; harnessId?: string; size?: number; effortId?: string; stateId?: string }) {
  return <Image accessibilityRole="image" accessibilityLabel={`${name} identity orb`} source={avatars[avatarPresetForHarness(harnessId ?? "")]} style={{ width: size, height: size, borderRadius: size / 2, opacity: .92 }} />;
});
