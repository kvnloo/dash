import { useEffect, useState } from "react";
import { Image, Modal, Text, View } from "react-native";
import { store } from "../../store/app";
import { executionToken } from "../../lib/bridge-auth";
import { colors, type } from "../../theme";
import { PressScale } from "../PressScale";
import ZoomImageDOM from "./ZoomImageDOM";

function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid image")); reader.onerror = reject; reader.readAsDataURL(blob); });
}
/** Never send bridge credentials to a URL from the model. Only our local /files route gets auth. */
export function InlineImage({ href, label = "Image" }: { href: string; label?: string }) {
  const [uri, setUri] = useState<string>();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const settings = store.use(s => s.settings);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setError(""); setUri(undefined);
    if (/^https?:\/\//i.test(href)) { setUri(href); return () => { active = false; }; }
    if (!href.startsWith("/") || href.startsWith("//") || !settings) { setError("Pair with the file's host to preview it."); return; }
    void (async () => {
      try {
        const token = await executionToken(settings);
        const response = await fetch(`http://${settings.address}/files?path=${encodeURIComponent(href)}`, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
        if (!response.ok) throw new Error(`Image unavailable (${response.status})`);
        const contentType = response.headers.get("content-type") ?? "";
        if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(contentType) || Number(response.headers.get("content-length")) > 12 * 1024 * 1024) throw new Error("Unsupported image");
        const blob = await response.blob();
        if (blob.size > 12 * 1024 * 1024) throw new Error("Image too large");
        const data = await blobData(blob);
        if (active) setUri(data);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Image unavailable"); }
    })();
    return () => { active = false; abort.abort(); };
  }, [href, settings]);
  return <View style={{ marginVertical: 8 }}>
    {uri ? <PressScale accessibilityRole="button" accessibilityLabel={`Open image: ${label}`} onPress={() => setOpen(true)}>
      <Image source={{ uri }} accessibilityLabel={label} onError={() => setError("Image could not be loaded")} style={{ width: "100%", height: 190, borderRadius: 12, backgroundColor: colors.surfaceRaised }} resizeMode="contain" />
      <Text style={{ ...type.small, color: colors.textMuted, paddingTop: 6 }}>{label} · tap to expand</Text>
    </PressScale> : null}
    {error ? <Text style={{ ...type.small, color: colors.textMuted }}>{error}</Text> : null}
    <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 48 }}>
        <PressScale accessibilityRole="button" accessibilityLabel="Close image" onPress={() => setOpen(false)} style={{ minHeight: 44, padding: 12 }}><Text style={{ color: colors.gold }}>Close · {label}</Text></PressScale>
        {uri ? <ZoomImageDOM uri={uri} label={label} dom={{ style: { flex: 1 }, scrollEnabled: false, useExpoDOMWebView: false }} /> : null}
      </View>
    </Modal>
  </View>;
}
