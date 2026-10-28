import { TileDetailProvider } from "./src/components/InteractiveTile";
import { DensityProvider } from "./src/components/Density";
import { TileGestureProvider } from "./src/components/TileGestures";
import { OrbMotionProvider } from "./src/components/OrbMotion";
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
import { NoticesScreen } from "./src/screens/NoticesScreen";
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
import { RoadmapProjectScreen, RoadmapScreen, RoadmapTaskScreen } from "./src/screens/RoadmapScreen";
import { DebugHost } from "./src/debug/DebugHost";
import { AnnotationRoot } from "./src/components/annotate/AnnotationRoot";
import { isDebugActive } from "./src/debug/expose";
import { debugNavigationRef, flushPendingDebugNavigation } from "./src/debug/nav";
import { clearDebugPersistence, applyDebugSeed } from "./src/debug/seed";
import { applyDemoSeed } from "./src/mock/seed";
import { hydrate, store } from "./src/store/app";
import { colors } from "./src/theme";
import { NativeEvents } from "./src/components/NativeEvents";
import { ContinuousVoiceRoot } from "./src/components/ContinuousVoiceRoot";
import { ServedBuildChip } from "./src/components/ServedBuildChip";
import { observeTouch } from "./src/lib/touch-idle";
import { flushNotificationTarget, handleChatLink } from "./src/lib/notification-routing";

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
  open: (route) => {
    if (route === "Orchestra") debugNavigationRef.navigate("Main", { tab: 2 });
    else if (route === "Bots" || route === "Hosts") debugNavigationRef.navigate("Main", { tab: 0 });
    else if (route === "Chats") debugNavigationRef.navigate("Main", { tab: 1 });
    else debugNavigationRef.navigate(route);
  },
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
    const openStage = (url: string | null) => Platform.OS !== "web" && (handleChatLink(url) || stageLinks.handle(url) || appRoutes.handle(url));
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
    <GestureHandlerRootView style={styles.root}><DensityProvider><OrbMotionProvider><TileGestureProvider><TileDetailProvider>
      {Platform.OS === "web" ? <style>{"input:focus,textarea:focus{outline:none!important}"}</style> : null}
      <SafeAreaProvider>
        <View style={styles.touchRoot} onStartShouldSetResponderCapture={observeTouch}>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>
          <BridgePullProvider>
            <NavigationContainer
              ref={debugNavigationRef}
              theme={theme}
              linking={Platform.OS === "web" ? linking : undefined}
              onReady={() => { flushPendingDebugNavigation(); deepLinks.flush(); stageLinks.flush(); appRoutes.flush(); flushNotificationTarget(); }}
            >
            <ContinuousVoiceRoot><AnnotationRoot>
              <Stack.Navigator
                initialRouteName={isDebugActive() || hasSettings ? "Main" : "Pair"}
                // Native-stack duration is iOS-only (and ignored for modal presentations).
                // Disable platform-owned transitions; bounded motion lives inside each screen.
                screenOptions={{ headerShown: false, contentStyle: styles.splash, animation: "none" }}
              >
                <Stack.Screen name="Main" component={MainScreen} />
                <Stack.Screen name="Approvals" component={ApprovalsScreen} />
                <Stack.Screen name="Notices" component={NoticesScreen} />
                <Stack.Screen name="ArtifactStage" component={ArtifactStageScreen} />
                <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => route.params?.window ? CHAT_WINDOW : {}} />
                <Stack.Screen name="OrchestraDetail" component={OrchestraDetailScreen} />
                <Stack.Screen name="Voice" component={VoiceScreen} options={{ presentation: "fullScreenModal" }} />
                <Stack.Screen name="Pair" component={PairScreen} />
                <Stack.Screen name="Settings" component={SettingsScreen} options={{ presentation: "modal" }} />
                <Stack.Screen name="Trace" component={TraceScreen} />
                <Stack.Screen name="Lab" component={LabScreen} />
                <Stack.Screen name="Roadmap" component={RoadmapScreen} />
                <Stack.Screen name="RoadmapProject" component={RoadmapProjectScreen} />
                <Stack.Screen name="RoadmapTask" component={RoadmapTaskScreen} />
              </Stack.Navigator>
              <BridgePullOverlay />
              <NativeEvents />
            </AnnotationRoot></ContinuousVoiceRoot>
            </NavigationContainer>
          </BridgePullProvider>
          <DebugHost />
          <ServedBuildChip />
          <StatusBar style="light" hidden />
        </KeyboardProvider>
        </View>
      </SafeAreaProvider>
    </TileDetailProvider></TileGestureProvider></OrbMotionProvider></DensityProvider></GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  touchRoot: { flex: 1 },
  splash: { flex: 1, backgroundColor: colors.bg },
  clear: { flex: 1, backgroundColor: "transparent" },
});

// A chat opened from the Chats list is a window over the still-painted workspace (list, page,
// scroll stay mounted). Its own morph runs inside ChatScreen; the platform transition stays off.
const CHAT_WINDOW = { presentation: "transparentModal" as const, animation: "none" as const, contentStyle: styles.clear };
