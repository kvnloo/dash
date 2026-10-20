import { DarkTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BridgePullOverlay, BridgePullProvider } from "./src/components/BridgePull";
import type { RootStackParamList } from "./src/navigation";
import { parseDashConnectUrl } from "./src/lib/pair-url";
import { bridge } from "./src/net/bridge";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ApprovalsScreen } from "./src/screens/ApprovalsScreen";
import { MainScreen } from "./src/screens/MainScreen";
import { OrchestraDetailScreen } from "./src/screens/OrchestraDetailScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { VoiceScreen } from "./src/screens/VoiceScreen";
import { DebugHost } from "./src/debug/DebugHost";
import { isDebugActive } from "./src/debug/expose";
import { debugNavigationRef, flushPendingDebugNavigation } from "./src/debug/nav";
import { clearDebugPersistence, applyDebugSeed } from "./src/debug/seed";
import { applyDemoSeed } from "./src/mock/seed";
import { hydrate, store } from "./src/store/app";
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
  // A link can prefill enrollment, but cannot authorize execution. Bootstrap
  // credentials stay out of URLs and must be provided privately on Pair.
  for (let attempt = 0; !debugNavigationRef.isReady() && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  if (!debugNavigationRef.isReady()) return false;
  debugNavigationRef.navigate("Pair", parsed);
  return true;
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
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>
          <BridgePullProvider>
            <NavigationContainer
              ref={debugNavigationRef}
              theme={theme}
              linking={Platform.OS === "web" ? linking : undefined}
              onReady={() => flushPendingDebugNavigation()}
            >
            <View style={styles.root}>
              <Stack.Navigator
                initialRouteName={isDebugActive() || hasSettings ? "Main" : "Pair"}
                screenOptions={{ headerShown: false, contentStyle: styles.splash, animation: "default" }}
              >
                <Stack.Screen name="Main" component={MainScreen} />
                <Stack.Screen name="Approvals" component={ApprovalsScreen} />
                <Stack.Screen name="Chat" component={ChatScreen} />
                <Stack.Screen name="OrchestraDetail" component={OrchestraDetailScreen} />
                <Stack.Screen name="Voice" component={VoiceScreen} options={{ presentation: "fullScreenModal" }} />
                <Stack.Screen name="Pair" component={PairScreen} />
                <Stack.Screen name="Settings" component={SettingsScreen} options={{ presentation: "modal" }} />
              </Stack.Navigator>
              <BridgePullOverlay />
            </View>
            </NavigationContainer>
          </BridgePullProvider>
          <DebugHost />
          <StatusBar style="light" />
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  splash: { flex: 1, backgroundColor: colors.bg },
});
