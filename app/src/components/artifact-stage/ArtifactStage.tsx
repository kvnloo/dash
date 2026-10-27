import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import ArtifactStageDom from "./ArtifactStageDom";

/**
 * The artifact-stage review surface. Native default: react-native-webview, which
 * ships in Expo Go. The installed Expo Go lacks the DOM-component native module
 * (`ExpoDomWebViewModule`), so the DOM path crashed with a red screen on the S25.
 * Opt into the Expo DOM component with `EXPO_PUBLIC_STAGE_DOM=1`. Web always uses DOM.
 */
export function ArtifactStage({ url, title, fallback }: { url: string; title?: string; fallback?: "webview" }) {
  const webview = fallback === "webview" || process.env.EXPO_PUBLIC_STAGE_DOM !== "1";
  if (webview && Platform.OS !== "web") {
    return (
      <WebView
        accessibilityLabel={title ?? "artifact stage"}
        source={{ uri: url }}
        // Reviews are rebuilt in place; never retain yesterday's toolbar bundle.
        cacheEnabled={false}
        cacheMode="LOAD_NO_CACHE"
        style={styles.fill}
        containerStyle={styles.fill}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="always"
        setSupportMultipleWindows={false}
      />
    );
  }
  return (
    <View style={styles.fill} accessibilityLabel={title ?? "artifact stage"}>
      <ArtifactStageDom url={url} title={title} dom={{ style: { flex: 1 }, matchContents: false, mixedContentMode: "always", allowsInlineMediaPlayback: true }} />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: "#1e2030" } });
