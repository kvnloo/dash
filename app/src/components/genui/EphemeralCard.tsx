import { View } from "react-native";
import { WebView } from "react-native-webview";
import { cardTitle, EphemeralCardFooter, styles, useEphemeralCard, type EphemeralCardProps } from "./ephemeral-card-host";

/** Native: the repo's card in a WebView with no navigation, network, file access or popups. */
export function EphemeralCard(props: EphemeralCardProps) {
  const { spec, onIntent, source, onDrawn } = props;
  const card = useEphemeralCard(spec, onIntent, onDrawn);
  return <View accessible={false} accessibilityLabel={cardTitle(props)} style={styles.root}>
    <WebView
      source={{ html: card.html, baseUrl: "about:blank" }}
      originWhitelist={["about:blank"]}
      containerStyle={{ flex: 0, height: card.height }}
      style={{ backgroundColor: "transparent" }}
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
    <EphemeralCardFooter spec={spec} card={card} source={source} />
  </View>;
}
