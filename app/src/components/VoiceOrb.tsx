import { WebView } from "react-native-webview";
import { orbHtml, type OrbPhase, type OrbPreset } from "./orb-html";
export function VoiceOrb({ preset, phase = "idle", size = 190 }: { preset: OrbPreset; phase?: OrbPhase; size?: number }) {
 return <WebView accessibilityLabel={`${preset} voice orb, ${phase}`} originWhitelist={["about:blank"]} source={{ html: orbHtml(preset, phase, process.env.EXPO_PUBLIC_ZEROS_THEME === "proof-mono") }} scrollEnabled={false} onShouldStartLoadWithRequest={r => r.url === "about:blank"} style={{ width: size, height: size, backgroundColor: "transparent" }} containerStyle={{ width: size, height: size, flex: 0 }} />;
}
