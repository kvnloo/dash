import { memo } from "react";
import { Image } from "react-native";
import { presetForHarness, type OrbPreset } from "./orb-html";
const assets: Record<OrbPreset, number> = process.env.EXPO_PUBLIC_ZEROS_THEME === "proof-mono" ? {
 chatgpt: require("../../assets/orbs/chatgpt-mono.png"), gemini: require("../../assets/orbs/gemini-mono.png"), siri: require("../../assets/orbs/siri-mono.png"), alexa: require("../../assets/orbs/alexa-mono.png"), elevenlabs: require("../../assets/orbs/elevenlabs-mono.png"), grok: require("../../assets/orbs/grok-mono.png"),
} : {
 chatgpt: require("../../assets/orbs/chatgpt.png"), gemini: require("../../assets/orbs/gemini.png"), siri: require("../../assets/orbs/siri.png"), alexa: require("../../assets/orbs/alexa.png"), elevenlabs: require("../../assets/orbs/elevenlabs.png"), grok: require("../../assets/orbs/grok.png"),
};
/** Small static source-catalog preset. Runtime status is an adjacent truthful dot. */
export const HarnessAvatar = memo(function HarnessAvatar({ name, harnessId, size = 40 }: { name: string; harnessId?: string; size?: number; effortId?: string; stateId?: string }) {
 return <Image accessibilityRole="image" accessibilityLabel={`${name} identity orb`} source={assets[presetForHarness(harnessId ?? "")]} style={{ width: size, height: size, borderRadius: size / 2, opacity: .95 }} />;
});
