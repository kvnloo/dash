import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import ArtifactStageDom from "./ArtifactStageDom";

/**
 * The artifact-stage review surface. Default: an Expo DOM component (Expo Go,
 * no native module). `EXPO_PUBLIC_STAGE_WEBVIEW=1` or `fallback="webview"`
 * uses react-native-webview directly, for builds where DOM components are off.
 */
export function ArtifactStage({ url, title, fallback }: { url: string; title?: string; fallback?: "webview" }) {
  const webview = fallback === "webview" || process.env.EXPO_PUBLIC_STAGE_WEBVIEW === "1";
  if (webview && Platform.OS !== "web") {
    return (
      <WebView
        accessibilityLabel={title ?? "artifact stage"}
        source={{ uri: url }}
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
