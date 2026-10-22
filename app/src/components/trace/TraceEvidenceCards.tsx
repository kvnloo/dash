import { useEffect, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { store } from "../../store/app";
import { fonts, space } from "../../theme";
import type { TraceArtifact, TraceEvidence } from "../../../../shared/trace-evidence";
import { tc } from "./tokens";
export type TraceRoute = "Trace" | "Lab" | "Settings" | "Approvals" | "Main";

export function TraceEvidenceCards({ evidence, onNavigate }: { evidence?: TraceEvidence; onNavigate?(route: TraceRoute): void }) {
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [artifactPage, setArtifactPage] = useState(0);
  const artifacts = evidence?.artifacts ?? [];
  return <View style={s.stack} testID="trace-evidence">
    <Text style={s.heading}>INTENT CONTRACT</Text>
    {evidence ? <>
      <Text style={s.label}>{evidence.quoteRedacted ? "You asked · secrets redacted" : "You asked · verbatim"}</Text>
      <Text style={s.quote} selectable numberOfLines={quoteOpen ? undefined : 6}>{evidence.quote || "Original owner request unavailable"}</Text>
      {evidence.quote.length > 200 ? <Pressable onPress={() => setQuoteOpen(v => !v)} accessibilityRole="button"><Text style={s.label}>{quoteOpen ? "Less" : "Read full request"}</Text></Pressable> : null}
      <Text style={s.muted}>Goal · {evidence.intent.constraints.goal.slice(0, 180)}{evidence.intent.constraints.goal.length > 180 ? "…" : ""}</Text>
      {evidence.intent.constraints.rules.map((r, i) => <Text key={i} style={s.muted}>Constraint · {r}</Text>)}
      <Text style={s.muted}>AODL / HOTL {evidence.intent.specVersion} · extracted intent, not an observed plan</Text>
    </> : <Text style={s.muted}>No original contract in this snapshot. Pair with a bridge to load run evidence.</Text>}
    <Text style={s.heading}>VALIDATION</Text>
    {evidence?.checks.length ? evidence.checks.map(c => <View key={c.id} style={s.card}>
      <Text style={s.body}>{c.status === "pass" ? "✓" : c.status === "fail" ? "×" : "?"} {c.text}</Text>
      <Text style={s.muted}>{c.status === "unknown" ? "Unknown · no criterion-bound receipt" : `${c.status} · linked receipt`}</Text>
      {c.evidence.map(path => <Artifact key={path} artifact={{ kind: "file", title: "Receipt", target: path }} onNavigate={onNavigate} />)}
    </View>) : <Text style={s.muted}>Unknown · no explicit acceptance checks recovered. No success is inferred from a report or Metro log.</Text>}
    <Text style={s.heading}>ARTIFACTS</Text>
    {artifacts.length ? artifacts.slice(artifactPage * 6, artifactPage * 6 + 6).map(a => <Artifact key={a.target} artifact={a} onNavigate={onNavigate} />) : <Text style={s.muted}>No relevant outputs discovered.</Text>}
    {artifacts.length > 6 ? <Pressable onPress={() => setArtifactPage(p => (p + 1) * 6 >= artifacts.length ? 0 : p + 1)} accessibilityRole="button"><Text style={s.label}>Next artifacts · {artifactPage * 6 + 1}–{Math.min(artifacts.length, artifactPage * 6 + 6)} of {artifacts.length}</Text></Pressable> : null}
    {evidence?.warnings.map((w, i) => <Text key={i} style={s.muted}>{w}</Text>)}
  </View>;
}
function Artifact({ artifact: a, onNavigate }: { artifact: TraceArtifact; onNavigate?(route: TraceRoute): void }) {
  const settings = store.use(s => s.settings);
  const [image, setImage] = useState(""), [preview, setPreview] = useState(""), [error, setError] = useState("");
  const local = a.target.startsWith("/"), isImage = a.kind === "image" || a.kind === "storyboard";
  useEffect(() => {
    setImage(""); setPreview(""); setError("");
    if (!local || !isImage || !settings) return;
    let disposed = false;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    void fetch(`http://${settings.address}/trace/artifact?path=${encodeURIComponent(a.target)}`, { headers: { Authorization: `Bearer ${settings.token.trim()}` }, signal: controller.signal }).then(async r => {
      if (!r.ok || !r.headers.get("Content-Type")?.startsWith("image/")) throw new Error("Image unavailable");
      const blob = await r.blob();
      if (blob.size > 8 * 1024 * 1024) throw new Error("Image too large");
      const reader = new FileReader();
      reader.onload = () => { if (!disposed && typeof reader.result === "string") setImage(reader.result); };
      reader.readAsDataURL(blob);
    }).catch(() => { if (!disposed) setError("Image unavailable · authenticated bridge required"); }).finally(() => clearTimeout(timer));
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [a.target, isImage, local, settings?.address, settings?.token]);
  async function open() {
    if (a.kind === "dash") {
      const route = a.target.slice("dash://".length);
      if (route === "Trace" || route === "Lab" || route === "Settings" || route === "Approvals" || route === "Main") onNavigate?.(route);
    } else if (!local) { try { await Linking.openURL(a.target); } catch { setError("Could not open link"); } }
    else if (settings && !isImage) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
      try {
        const r = await fetch(`http://${settings.address}/trace/artifact?path=${encodeURIComponent(a.target)}`, { headers: { Authorization: `Bearer ${settings.token.trim()}` }, signal: controller.signal });
        if (!r.ok) throw new Error("unavailable");
        setPreview((await r.text()).slice(0, 4000));
      } catch { setError("File unavailable · allowlisted text only"); } finally { clearTimeout(timer); }
    } else if (!settings) setError("Pair with the originating bridge to open this file");
  }
  return <Pressable style={s.card} onPress={() => void open()} accessibilityRole="button" accessibilityLabel={`${a.kind}: ${a.title}`}>
    <Text style={s.body}>{a.kind === "dash" ? "Take me there → " : ""}{a.title}</Text>
    <Text style={s.muted} numberOfLines={2}>{a.target}</Text>
    {image ? <Image source={{ uri: image }} style={s.image} resizeMode="contain" accessibilityLabel={a.title} /> : null}
    {preview || a.preview ? <Text style={s.muted} selectable>{preview || a.preview}</Text> : null}
    {error ? <Text style={s.muted}>{error}</Text> : null}
  </Pressable>;
}
const s = StyleSheet.create({
  stack: { gap: space.sm }, heading: { fontFamily: fonts.mono, fontSize: 11, color: tc.text3, marginTop: space.md },
  label: { fontFamily: fonts.mono, fontSize: 11, color: tc.live }, quote: { color: tc.text, fontSize: 16, lineHeight: 23 },
  body: { color: tc.text, fontSize: 14, lineHeight: 20 }, muted: { color: tc.text3, fontSize: 11, lineHeight: 17 },
  card: { padding: space.sm, gap: 5, backgroundColor: tc.raised, borderWidth: 1, borderColor: tc.rule, borderRadius: 8 },
  image: { width: "100%", height: 220 },
});
