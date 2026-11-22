import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { NATIVE_WALLPAPER_ASSETS } from "../../vendor/blueprint-wallpaper/assets.generated";
import { WALLPAPER_PLAYER_JS } from "../../vendor/blueprint-wallpaper/player.generated";

/** `</script>` inside the inlined bundle would end the tag early. */
const inline = (js: string) => js.replace(/<\/script/gi, "<\\/script");

function page(): string {
  const config = JSON.stringify({ assets: NATIVE_WALLPAPER_ASSETS, force: null });
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0c0c0a}
#wallpaper{position:fixed;inset:0;background:#0c0c0a url(${NATIVE_WALLPAPER_ASSETS.base}) center/cover no-repeat}</style></head>
<body><div id="wallpaper"></div><script>window.__DASH_WALLPAPER__=${inline(config)};</script><script>${inline(WALLPAPER_PLAYER_JS)}</script></body></html>`;
}

/**
 * Native: the same blueprint player in a WebView behind the app (Android System WebView /
 * WKWebView carry WebGL). Touch stays with Dash; the page paints the poster until WebGL is up.
 */
export function BlueprintWallpaper() {
  const html = useMemo(page, []);
  const onMessage = (event: WebViewMessageEvent) => {
    let message: unknown;
    try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (!message || typeof message !== "object") return;
    const type: unknown = Reflect.get(message, "type");
    if (type === "fail") console.warn("[wallpaper] native player fell back to the poster:", Reflect.get(message, "reason"));
  };
  return <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="blueprint-wallpaper" importantForAccessibility="no-hide-descendants">
    <WebView
      source={{ html }}
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={request => request.url.startsWith("about:") || request.url.startsWith("data:")}
      onMessage={onMessage}
      style={styles.web}
      scrollEnabled={false}
      overScrollMode="never"
      javaScriptEnabled
      mediaPlaybackRequiresUserAction
      setSupportMultipleWindows={false}
      androidLayerType="hardware"
      testID="blueprint-wallpaper-webview"
    />
  </View>;
}

const styles = StyleSheet.create({ web: { flex: 1, backgroundColor: "#0c0c0a" } });
