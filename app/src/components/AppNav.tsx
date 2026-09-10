import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { NavigationProp } from "@react-navigation/native";
import { haptic } from "../haptics";
import type { RootStackParamList } from "../navigation";
import { goldenNavHtml, navSetProgressScript, parseNavMessage } from "./golden-nav";

export type AppNavHandle = {
  /** Drive the gold pill with PagerView position+offset. Does not re-render React. */
  setProgress(progress: number): void;
};

/**
 * Native AppNav renders the same CSS as the Chrome probe, inside a WebView.
 * React Native StyleSheet cannot run oklch / color-mix / backdrop-filter.
 */
export const AppNav = forwardRef<
  AppNavHandle,
  {
    navigation: NavigationProp<RootStackParamList>;
    tab: number;
    onTab?(next: number): void;
  }
>(function AppNav({ navigation, tab, onTab }, ref) {
  const web = useRef<WebView>(null);
  const initialTab = useRef(tab).current;
  const html = useMemo(() => goldenNavHtml(initialTab), [initialTab]);
  const source = useMemo(() => ({ html, baseUrl: "https://localhost/" }), [html]);

  const setProgress = (next: number) => {
    web.current?.injectJavaScript(navSetProgressScript(next));
  };

  useImperativeHandle(ref, () => ({ setProgress }), []);

  useEffect(() => {
    setProgress(tab);
  }, [tab]);

  const onMessage = (event: WebViewMessageEvent) => {
    const msg = parseNavMessage(event.nativeEvent.data);
    if (!msg) return;
    haptic.tap();
    if (msg.type === "expand") {
      navigation.navigate("Voice");
      return;
    }
    if (msg.type === "menu") {
      navigation.navigate("Settings");
      return;
    }
    if (onTab) onTab(msg.index);
    else navigation.navigate("Main", { tab: msg.index });
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <WebView
        ref={web}
        originWhitelist={["*"]}
        source={source}
        onLoadEnd={() => setProgress(tab)}
        onMessage={onMessage}
        injectedJavaScript={navSetProgressScript(tab)}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        javaScriptEnabled
        androidLayerType="software"
        containerStyle={styles.web}
        style={styles.web}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { height: 80, backgroundColor: "transparent", overflow: "visible" },
  web: { flex: 1, backgroundColor: "transparent" },
});
