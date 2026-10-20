import { orbHtml, type OrbPhase, type OrbPreset } from "./orb-html";
export function VoiceOrb({ preset, phase = "idle", size = 190 }: { preset: OrbPreset; phase?: OrbPhase; size?: number }) {
 return <iframe title={`${preset} voice orb, ${phase}`} sandbox="allow-scripts" srcDoc={orbHtml(preset, phase, process.env.EXPO_PUBLIC_ZEROS_THEME === "proof-mono")} style={{ width: size, height: size, border: 0, background: "transparent", borderRadius: "50%", flexShrink: 0 }} />;
}
