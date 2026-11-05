import { View } from "react-native";
import { WebView } from "react-native-webview";
import type { LiveIntent } from "../../../../shared/live";
import type { EphemeralCardSpec } from "../../lib/ephemeral-card";
import { EphemeralCardFooter, styles, useEphemeralCard } from "./ephemeral-card-host";

/** Native: the repo's card in a WebView with no navigation, network, file access or popups. */
export function EphemeralCard({ spec, onIntent }: { spec: EphemeralCardSpec; onIntent?: (intent: LiveIntent) => boolean }) {
  const card = useEphemeralCard(spec, onIntent);
  return <View accessible={false} accessibilityLabel={`${spec.app} ${spec.kind} card`} style={styles.root}>
    <WebView
      source={{ html: card.html, baseUrl: "about:blank" }}
      originWhitelist={["about:blank"]}
      style={{ height: card.height, backgroundColor: "transparent" }}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      mediaPlaybackRequiresUserAction
      scrollEnabled={false}
      nestedScrollEnabled
      overScrollMode="never"
      onShouldStartLoadWithRequest={request => request.url === "about:blank"}
      onMessage={event => card.receive(event.nativeEvent.data)}
    />
    <EphemeralCardFooter spec={spec} card={card} />
  </View>;
}
