import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import type { LiveIntent } from "../../../../shared/live";
import { ephemeralCardDocument, ephemeralIntent, parseEphemeralMessage, type EphemeralCardSpec, type EphemeralMessage } from "../../lib/ephemeral-card";
import { colors, radius, space, type } from "../../theme";
import { PressScale } from "../PressScale";

type Intent = Extract<EphemeralMessage, { type: "eui:intent" }>;

/** The host frame shared by native and web: status, height and the one agent handoff button. */
export function useEphemeralCard(spec: EphemeralCardSpec, onIntent?: (intent: LiveIntent) => boolean) {
  const scheme = useColorScheme() === "light" ? "light" : "dark";
  const html = useMemo(() => ephemeralCardDocument(spec, scheme), [spec, scheme]);
  const [height, setHeight] = useState(360);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [last, setLast] = useState<Intent | null>(null);
  const [notice, setNotice] = useState("");
  const seen = useRef("");
  const receiveRef = useRef<(raw: unknown) => void>(() => {});
  const receive = (raw: unknown) => receiveRef.current(raw);
  receiveRef.current = (raw: unknown) => {
    const message = parseEphemeralMessage(raw);
    if (!message) return;
    if (message.type === "eui:size") setHeight(message.height);
    else if (message.type === "eui:ready") setStatus("ready");
    else if (message.type === "eui:error") setStatus("error");
    else {
      const key = `${message.at}:${message.action}`;
      if (message.at && seen.current === key) return;
      seen.current = key;
      setLast(message);
      setNotice("");
    }
  };
  // receive is stable for the card's lifetime, so a web message listener is attached once.
  const stable = useRef(receive).current;
  const send = () => {
    if (!last || !onIntent) return;
    const ok = onIntent(ephemeralIntent(spec, last));
    setNotice(ok ? `Sent to agent: ${last.label}` : "Not sent · agent busy or offline. Try again.");
    if (ok) setLast(null);
  };
  return { html, height, status, last, notice, send, receive: stable, canSend: !!onIntent };
}

export function EphemeralCardFooter({ spec, card }: { spec: EphemeralCardSpec; card: ReturnType<typeof useEphemeralCard> }) {
  return <View style={styles.foot}>
    {card.status === "error" ? <Text accessibilityRole="alert" style={styles.meta}>This card could not be drawn. Ask me to send it again.</Text> : null}
    {card.last && card.canSend ? <PressScale accessibilityRole="button" accessibilityLabel={`Send to agent: ${card.last.label}`} onPress={card.send} style={styles.send}>
      <Text numberOfLines={2} style={styles.sendText}>Send to agent · {card.last.label}</Text>
    </PressScale> : null}
    {card.notice ? <Text role="status" style={styles.meta}>{card.notice}</Text> : null}
    <Text style={styles.source}>ephemeral-ui · {spec.kind} · {spec.app} · kit sample data</Text>
  </View>;
}

export const styles = StyleSheet.create({
  root: { marginVertical: space.sm, gap: space.xs, borderRadius: radius.md, overflow: "hidden" },
  foot: { gap: space.xs },
  send: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold },
  sendText: { ...type.small, color: colors.gold },
  meta: { ...type.small, color: colors.textMuted },
  source: { ...type.small, color: colors.textFaint },
});
