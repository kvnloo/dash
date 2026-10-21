import { DarkTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { CormorantGaramond_500Medium } from "@expo-google-fonts/cormorant-garamond";
import { HankenGrotesk_400Regular, HankenGrotesk_600SemiBold } from "@expo-google-fonts/hanken-grotesk";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono";
import { useEffect } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BridgePullOverlay, BridgePullProvider } from "./src/components/BridgePull";
import type { RootStackParamList } from "./src/navigation";
import { createDeepLinkRouter } from "./src/lib/deep-link";
import { bridge } from "./src/net/bridge";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ApprovalsScreen } from "./src/screens/ApprovalsScreen";
import { ArtifactStageScreen } from "./src/screens/ArtifactStageScreen";
import { createStageLinkRouter } from "./src/lib/stage-router";
import { createAppRouteRouter } from "./src/lib/app-route-link";
import { MainScreen } from "./src/screens/MainScreen";
import { OrchestraDetailScreen } from "./src/screens/OrchestraDetailScreen";
import { PairScreen } from "./src/screens/PairScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { VoiceScreen } from "./src/screens/VoiceScreen";
import { TraceScreen } from "./src/screens/TraceScreen";
import { LabScreen } from "./src/screens/LabScreen";
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
    initialRouteName: "Main" as const,
    screens: {
      Pair: "connect",
      ArtifactStage: "stage",
      Trace: "trace",
      Lab: "lab",
    },
  },
};

// A link can prefill enrollment, but cannot authorize execution. Bootstrap
// credentials stay out of URLs and must be provided privately on Pair.
// Expo Go delivers `exp://<metro>/--/connect?…`; dev builds deliver `dash://connect?…`.
const deepLinks = createDeepLinkRouter({
  isReady: () => debugNavigationRef.isReady(),
  openPair: (prefill) => debugNavigationRef.navigate("Pair", prefill),
});

const stageLinks = createStageLinkRouter({
  isReady: () => debugNavigationRef.isReady(),
  openStage: url => debugNavigationRef.navigate("ArtifactStage", { url }),
});
// Lab / Trace: exp://<metro>/--/lab, exp://<metro>/--/trace (dash://lab, dash://trace in dev builds).
const appRoutes = createAppRouteRouter({
  isReady: () => debugNavigationRef.isReady(),
  open: (route) => debugNavigationRef.navigate(route),
});

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ CormorantGaramond_500Medium, HankenGrotesk_400Regular, HankenGrotesk_600SemiBold, IBMPlexMono_400Regular });
  if (fontError) throw fontError;
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
    // Web stage and app-route URLs belong to NavigationContainer linking, not a second handler.
    const openStage = (url: string | null) => Platform.OS !== "web" && (stageLinks.handle(url) || appRoutes.handle(url));
    void Linking.getInitialURL().then((url) => {
      if (!openStage(url)) deepLinks.handle(url);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (openStage(url)) return;
      deepLinks.handle(url);
    });
    return () => sub.remove();
  }, []);

  if (!hydrated || !fontsLoaded) return <View style={styles.splash} />;

  return (
    <GestureHandlerRootView style={styles.root}>
      {Platform.OS === "web" ? <style>{"input:focus,textarea:focus{outline:none!important}"}</style> : null}
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>
          <BridgePullProvider>
            <NavigationContainer
              ref={debugNavigationRef}
              theme={theme}
              linking={Platform.OS === "web" ? linking : undefined}
              onReady={() => { flushPendingDebugNavigation(); deepLinks.flush(); stageLinks.flush(); appRoutes.flush(); }}
            >
            <View style={styles.root}>
              <Stack.Navigator
                initialRouteName={isDebugActive() || hasSettings ? "Main" : "Pair"}
                // Every screen draws the same nav bar at the same place. A fade keeps it still while the
                // content changes; a slide carried a second copy of the bar across the screen.
                screenOptions={{ headerShown: false, contentStyle: styles.splash, animation: "fade", animationDuration: 200 }}
              >
                <Stack.Screen name="Main" component={MainScreen} />
                <Stack.Screen name="Approvals" component={ApprovalsScreen} />
                <Stack.Screen name="ArtifactStage" component={ArtifactStageScreen} />
                <Stack.Screen name="Chat" component={ChatScreen} />
                <Stack.Screen name="OrchestraDetail" component={OrchestraDetailScreen} />
                <Stack.Screen name="Voice" component={VoiceScreen} options={{ presentation: "fullScreenModal" }} />
                <Stack.Screen name="Pair" component={PairScreen} />
                <Stack.Screen name="Settings" component={SettingsScreen} options={{ presentation: "modal" }} />
                <Stack.Screen name="Trace" component={TraceScreen} />
                <Stack.Screen name="Lab" component={LabScreen} />
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
