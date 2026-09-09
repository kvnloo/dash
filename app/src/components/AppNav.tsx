import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { NavigationProp } from "@react-navigation/native";
import { haptic } from "../haptics";
import type { RootStackParamList } from "../navigation";
import { goldenNavHtml } from "./golden-nav";

/**
 * Native AppNav renders the same CSS as the Chrome probe, inside a WebView.
 * React Native StyleSheet cannot run oklch / color-mix / backdrop-filter.
 */
export function AppNav({
  navigation,
  tab,
  onTab,
}: {
  navigation: NavigationProp<RootStackParamList>;
  tab: number;
  onTab?(next: number): void;
}) {
  const web = useRef<WebView>(null);
  const html = useMemo(() => goldenNavHtml(1), []);

  const syncTab = (next: number) => {
    web.current?.injectJavaScript(`window.setTab && window.setTab(${next}); true;`);
  };

  useEffect(() => {
    syncTab(tab);
  }, [tab]);

  const onMessage = (event: WebViewMessageEvent) => {
    let msg: { type?: string; index?: number };
    try {
      msg = JSON.parse(event.nativeEvent.data) as { type?: string; index?: number };
    } catch {
      return;
    }
    haptic.tap();
    if (msg.type === "expand") {
      navigation.navigate("Voice");
      return;
    }
    if (msg.type === "menu") {
      navigation.navigate("Settings");
      return;
    }
    if (msg.type === "tab" && typeof msg.index === "number") {
      if (onTab) onTab(msg.index);
      else navigation.navigate("Main", { tab: msg.index });
    }
  };

  return (
    <View style={styles.wrap}>
      <WebView
        ref={web}
        originWhitelist={["*"]}
        source={{ html }}
        onLoadEnd={() => syncTab(tab)}
        onMessage={onMessage}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        javaScriptEnabled
        opaque={false}
        containerStyle={styles.web}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 60, backgroundColor: "transparent" },
  web: { flex: 1, backgroundColor: "transparent" },
});
