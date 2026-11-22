import { createElement, useEffect, useRef } from "react";
import { View } from "react-native";
import { cardTitle, EphemeralCardFooter, styles, useEphemeralCard, type EphemeralCardProps } from "./ephemeral-card-host";

/** Web: the repo's card in a no-same-origin sandboxed iframe (scripts only); only its own window may post. */
export function EphemeralCard(props: EphemeralCardProps) {
  const { spec, onIntent, source, onDrawn } = props;
  const card = useEphemeralCard(spec, onIntent, onDrawn);
  const ref = useRef<HTMLIFrameElement | null>(null);
  const { receive } = card;
  useEffect(() => {
    const listener = (event: MessageEvent) => { if (ref.current && event.source === ref.current.contentWindow) receive(event.data); };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [receive]);
  return <View accessibilityLabel={cardTitle(props)} style={styles.root}>
    {createElement("iframe", {
      ref,
      title: cardTitle(props),
      sandbox: "allow-scripts",
      srcDoc: card.html,
      style: { width: "100%", height: card.height, border: "0", background: "transparent", display: "block" },
    })}
    <EphemeralCardFooter spec={spec} card={card} source={source} />
  </View>;
}
