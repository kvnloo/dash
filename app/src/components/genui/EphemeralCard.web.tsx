import { createElement, useEffect, useRef } from "react";
import { View } from "react-native";
import type { LiveIntent } from "../../../../shared/live";
import type { EphemeralCardSpec } from "../../lib/ephemeral-card";
import { EphemeralCardFooter, styles, useEphemeralCard } from "./ephemeral-card-host";

/** Web: the repo's card in a no-same-origin sandboxed iframe (scripts only); only its own window may post. */
export function EphemeralCard({ spec, onIntent }: { spec: EphemeralCardSpec; onIntent?: (intent: LiveIntent) => boolean }) {
  const card = useEphemeralCard(spec, onIntent);
  const ref = useRef<HTMLIFrameElement | null>(null);
  const { receive } = card;
  useEffect(() => {
    const listener = (event: MessageEvent) => { if (ref.current && event.source === ref.current.contentWindow) receive(event.data); };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [receive]);
  return <View accessibilityLabel={`${spec.app} ${spec.kind} card`} style={styles.root}>
    {createElement("iframe", {
      ref,
      title: `${spec.app} ${spec.kind} card`,
      sandbox: "allow-scripts",
      srcDoc: card.html,
      style: { width: "100%", height: card.height, border: "0", background: "transparent", display: "block" },
    })}
    <EphemeralCardFooter spec={spec} card={card} />
  </View>;
}
