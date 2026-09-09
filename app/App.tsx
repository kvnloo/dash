import { DarkTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { RootStackParamList } from "./src/navigation";
import { claimPairAt, settingsFromClaim } from "./src/lib/pair-api";
import { parseDashConnectUrl } from "./src/lib/pair-url";
import { haptic } from "./src/haptics";
import { bridge } from "./src/net/bridge";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ConversationsScreen } from "./src/screens/ConversationsScreen";
import { MainScreen } from "./src/screens/MainScreen";
import { OrchestraDetailScreen } from "./src/screens/OrchestraDetailScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { DebugHost } from "./src/debug/DebugHost";
import { isDebugActive } from "./src/debug/expose";
import { debugNavigationRef, flushPendingDebugNavigation } from "./src/debug/nav";
import { clearDebugPersistence, applyDebugSeed } from "./src/debug/seed";
import { applyDemoSeed } from "./src/mock/seed";
import { hydrate, saveSettings, store } from "./src/store/app";
import { colors } from "./src/theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

const theme: Theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.border },
};

const linking = {
  prefixes: ["dash://"],
  config: {
    screens: {
      Pair: "connect",
    },
  },
};

async function applyDeepLink(url: string): Promise<boolean> {
  const parsed = parseDashConnectUrl(url);
  if (!parsed) return false;
  try {
    const claim = await claimPairAt(parsed.address, parsed.code);
    const settings = settingsFromClaim(claim);
    saveSettings(settings);
    bridge.start(settings);
    haptic.success();
    return true;
  } catch {
    return false;
  }
}

export default function App() {
  const hydrated = store.use((s) => s.hydrated);
  const hasSettings = store.use((s) => s.settings !== null);

  useEffect(() => {
    void hydrate().then(async () => {
      if (isDebugActive()) {
        await clearDebugPersistence();
        applyDebugSeed("paired");
        return;
      }
      applyDemoSeed();
      const settings = store.get().settings;
      if (settings && process.env.EXPO_PUBLIC_DEMO !== "1") bridge.start(settings);
    });
  }, []);

  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      if (url) void applyDeepLink(url);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      void applyDeepLink(url);
    });
    return () => sub.remove();
  }, []);

  if (!hydrated) return <View style={styles.splash} />;

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <NavigationContainer
          ref={debugNavigationRef}
          theme={theme}
          linking={linking}
          onReady={() => flushPendingDebugNavigation()}
        >
          <Stack.Navigator
            initialRouteName={isDebugActive() || hasSettings ? "Main" : "Pair"}
            screenOptions={{ headerShown: false, contentStyle: styles.splash, animation: "default" }}
          >
            <Stack.Screen name="Main" component={MainScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="OrchestraDetail" component={OrchestraDetailScreen} />
            <Stack.Screen name="Conversations" component={ConversationsScreen} options={{ presentation: "modal" }} />
            <Stack.Screen name="Pair" component={PairScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ presentation: "modal" }} />
          </Stack.Navigator>
        </NavigationContainer>
        <DebugHost />
        <StatusBar style="light" />
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg },
});
