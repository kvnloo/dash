import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MainPager, type MainPagerRef } from "../components/MainPager";
import { applyScopeMention, GlobalSearchBar } from "../components/GlobalSearchBar";
import { ConnectionPill } from "../components/ConnectionPill";
import { KeyboardDock } from "../components/KeyboardDock";
import { AppNav, type AppNavHandle } from "../components/AppNav";
import { PAGE_LAG_PX, pageStep, pageStretch } from "../components/golden-nav";
import { SearchResultRow } from "../components/SearchResultRow";
import { isDebugActive } from "../debug/expose";
import { debugUi } from "../debug/ui-store";
import { haptic } from "../haptics";
import {
  formatSearchHint,
  parseSearchQuery,
  runGlobalSearch,
  type SearchResult,
} from "../lib/global-search";
import { FEEDBACK_CONVERSATION_ID, inAppFeedbackEnabled, type FeedbackAction } from "../lib/feedback";
import { submitInAppFeedback } from "../lib/feedback-submit";
import { DEFAULT_MAIN_TAB } from "../lib/home";
import { profilesFromHosts } from "../lib/roster";
import type { BotProfile } from "../mock/bots";
import type { ScreenProps } from "../navigation";
import { createConversation, saveSettings, setActive, setConnection, store } from "../store/app";
import { colors, space, type } from "../theme";
import { BotsPane } from "./panes/BotsPane";
import { ChatsPane } from "./panes/ChatsPane";
import { OrchestraPane } from "./panes/OrchestraPane";

function feedbackFromSearch(item: SearchResult): FeedbackAction {
  switch (item.kind) {
    case "bot":
      return {
        kind: "select",
        text: `Selected bot ${item.profile.name}`,
        selection: { kind: "bot", id: item.profile.id, label: item.profile.name },
      };
    case "conversation":
      return {
        kind: "select",
        text: `Selected chat ${item.conversation.title}`,
        selection: { kind: "chat", id: item.conversation.id, label: item.conversation.title },
      };
    case "product":
      return {
        kind: "select",
        text: `Selected orchestra ${item.project.name}`,
        selection: { kind: "orchestra", id: item.project.id, label: item.project.name },
      };
    case "harness":
      return {
        kind: "select",
        text: `Selected harness ${item.name}`,
        selection: { kind: "search", id: item.id, label: item.name },
      };
    case "skill":
      return {
        kind: "select",
        text: `Selected skill ${item.skill.name}`,
        selection: { kind: "search", id: item.skill.name, label: item.skill.name },
      };
    case "plugin":
      return {
        kind: "select",
        text: `Selected plugin ${item.plugin.name}`,
        selection: { kind: "search", id: item.plugin.name, label: item.plugin.name },
      };
    case "tool":
      return {
        kind: "select",
        text: `Selected tool ${item.tool.name}`,
        selection: { kind: "search", id: item.tool.name, label: item.tool.name },
      };
    case "file":
      return {
        kind: "select",
        text: `Selected file ${item.file.path}`,
        selection: { kind: "search", id: item.file.path, label: item.file.path },
      };
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function chatDraftForResult(item: SearchResult): string | undefined {
  switch (item.kind) {
    case "skill":
      return `Use the ${item.skill.name} skill. `;
    case "plugin":
      return `Use the ${item.plugin.name} plugin. `;
    case "tool":
      return `Use the ${item.tool.name} tool to `;
    case "file":
      return `Read ${item.file.path} and summarize.`;
    default:
      return undefined;
  }
}

export function MainScreen({ navigation, route }: ScreenProps<"Main">) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<MainPagerRef>(null);
  const navRef = useRef<AppNavHandle>(null);
  const pagerProgress = useSharedValue(DEFAULT_MAIN_TAB);
  const pageFollow = useSharedValue(DEFAULT_MAIN_TAB);
  const pageVel = useSharedValue(0);
  const routeTab = route.params?.tab;

  useFrameCallback((info) => {
    const raw = info.timeSincePreviousFrame;
    if (raw == null) return;
    const dt = Math.min(0.033, raw / 1000);
    if (dt <= 0) return;
    const next = pageStep(pageFollow.value, pageVel.value, pagerProgress.value, dt);
    pageFollow.value = next.pos;
    pageVel.value = next.vel;
  });

  const pageGelStyle = useAnimatedStyle(() => {
    const { scaleX, scaleY } = pageStretch(pageFollow.value, pagerProgress.value, pageVel.value);
    return {
      transform: [
        { translateX: (pageFollow.value - pagerProgress.value) * PAGE_LAG_PX },
        { scaleX },
        { scaleY },
      ],
    };
  });

  const debugSearch = debugUi.use((s) => s.mainSearchQuery);
  const debugTab = debugUi.use((s) => s.mainTabIndex);
  const [localQuery, setLocalQuery] = useState("");
  const [localTab, setLocalTab] = useState(DEFAULT_MAIN_TAB);
  const query = debugSearch !== null ? debugSearch : localQuery;
  const index = debugTab !== null ? debugTab : localTab;

  const setQuery = useCallback(
    (next: string | ((prev: string) => string)) => {
      setLocalQuery((localPrev) => {
        const current = debugSearch !== null ? debugSearch : localPrev;
        const value = typeof next === "function" ? next(current) : next;
        if (isDebugActive()) debugUi.set((s) => ({ ...s, mainSearchQuery: value }));
        return value;
      });
    },
    [debugSearch],
  );

  const setIndex = useCallback(
    (next: number) => {
      setLocalTab(next);
      if (isDebugActive()) debugUi.set((s) => ({ ...s, mainTabIndex: next }));
    },
    [],
  );

  useEffect(() => {
    if (typeof routeTab !== "number") return;
    setIndex(routeTab);
    pagerRef.current?.setPage(routeTab);
  }, [routeTab, setIndex]);

  const onPage = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      setIndex(e.nativeEvent.position);
    },
    [setIndex],
  );

  const conversations = store.use((s) => s.conversations);
  const harnesses = store.use((s) => s.connection.harnesses);
  const hosts = store.use((s) => s.connection.hosts);
  const settings = store.use((s) => s.settings);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const searchActive = parsed.mode !== "discover";
  const botProfiles = useMemo(() => (hosts.length > 0 ? profilesFromHosts(hosts) : undefined), [hosts]);

  const results = useMemo(
    () => runGlobalSearch({ query, conversations, harnesses, botProfiles, hosts }),
    [query, conversations, harnesses, botProfiles, hosts],
  );

  const hint = formatSearchHint(parsed);

  const openHarness = useCallback(
    (harnessId: string, draft?: string) => {
      if (!harnessId) return;
      haptic.select();
      if (settings) saveSettings({ ...settings, harness: harnessId });
      const existing = conversations.find((c) => c.harness === harnessId);
      if (existing) setActive(existing.id);
      else createConversation(harnessId);
      navigation.navigate("Chat", draft ? { draft } : undefined);
    },
    [conversations, navigation, settings],
  );

  const openBot = useCallback(
    (profile: BotProfile) => {
      if (!profile.online) return;
      openHarness(profile.harness);
    },
    [openHarness],
  );

  const openConversation = useCallback(
    (id: string) => {
      haptic.select();
      if (!conversations.some((c) => c.id === id)) {
        setConnection({ hosts });
      }
      setActive(id);
      navigation.navigate("Chat");
    },
    [conversations, hosts, navigation],
  );

  const openProduct = useCallback(
    (orchestraId: string) => {
      haptic.select();
      navigation.navigate("OrchestraDetail", { orchestraId });
    },
    [navigation],
  );

  const onResult = useCallback(
    (item: SearchResult) => {
      switch (item.kind) {
        case "bot":
          openBot(item.profile);
          break;
        case "conversation":
          openConversation(item.conversation.id);
          break;
        case "product":
          openProduct(item.project.id);
          break;
        case "harness":
          openHarness(item.id);
          break;
        case "skill":
        case "plugin":
        case "tool":
        case "file":
          openHarness("omp", chatDraftForResult(item));
          break;
      }
    },
    [openBot, openConversation, openHarness, openProduct],
  );

  const feedbackOn = inAppFeedbackEnabled(settings);

  const onFeedbackResult = useCallback(
    (item: SearchResult) => {
      if (!inAppFeedbackEnabled(store.get().settings)) return;
      haptic.select();
      submitInAppFeedback(feedbackFromSearch(item));
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const onScope = useCallback(
    (label: string) => {
      haptic.tap();
      setQuery((q) => applyScopeMention(q, label));
    },
    [setQuery],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchResult>) => (
      <SearchResultRow item={item} onPress={onResult} onLongPress={feedbackOn ? onFeedbackResult : undefined} />
    ),
    [feedbackOn, onFeedbackResult, onResult],
  );

  const emptyMessage =
    parsed.mode === "slash" && parsed.scope === "unknown"
      ? `Unknown /${parsed.rawScope}. Pick /live, /harness, /skill, /plugin, /tool, or /file.`
      : parsed.mode === "mention" && parsed.scope === "unknown"
        ? `Unknown @${parsed.rawScope}. Pick @bots, @conversation, or @product.`
        : parsed.mode === "slash"
          ? "No laptop resources match. Try another keyword or scope."
          : "No matches. Use @ for bots and chats, / for harness files and tools.";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <AppNav
        ref={navRef}
        navigation={navigation}
        tab={index}
        progress={pagerProgress}
        onTab={(next) => {
          pagerRef.current?.setPage(next);
        }}
      />
      <ConnectionPill />

      <View style={styles.body}>
        {searchActive ? (
          <>
            {hint ? (
              <Text style={styles.hint} accessibilityRole="text">
                {hint}
              </Text>
            ) : null}
            <FlashList
              data={results}
              renderItem={renderItem}
              keyExtractor={(item) => item.key}
              contentContainerStyle={{ paddingBottom: space.md }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No matches</Text>
                  <Text style={styles.emptySub}>{emptyMessage}</Text>
                </View>
              }
            />
          </>
        ) : (
          <Animated.View style={[styles.pager, pageGelStyle]} collapsable={false}>
            <MainPager
              ref={pagerRef}
              style={styles.pager}
              page={index}
              initialPage={index}
              onPageSelected={onPage}
              progress={pagerProgress}
              pageWidth={width}
              overdrag
            >
              <View key="bots" style={{ width }}>
                <BotsPane navigation={navigation} />
              </View>
              <View key="chats" style={{ width }}>
                <ChatsPane navigation={navigation} />
              </View>
              <View key="orchestra" style={{ width }}>
                <OrchestraPane navigation={navigation} />
              </View>
            </MainPager>
          </Animated.View>
        )}
      </View>

      <KeyboardDock style={styles.searchDock}>
        <GlobalSearchBar
          value={query}
          onChange={setQuery}
          onScope={onScope}
          dock="bottom"
          placeholder={feedbackOn ? "Feedback for Dash" : "Message Dash"}
          onVoice={() => {
            if (feedbackOn) {
              createConversation(settings?.harness ?? "omp", {
                id: FEEDBACK_CONVERSATION_ID,
                title: "Dash feedback",
              });
            }
            navigation.navigate("Voice");
          }}
          onSend={(text) => {
            if (feedbackOn) {
              haptic.select();
              submitInAppFeedback({ kind: "typed", text });
              navigation.navigate("Chat");
              setQuery("");
              return;
            }
            const harness = settings?.harness ?? harnesses[0]?.id;
            if (!harness) return;
            openHarness(harness, text);
            setQuery("");
          }}
        />
      </KeyboardDock>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, overflow: "visible" },
  pager: { flex: 1, overflow: "visible" },
  searchDock: {
    backgroundColor: colors.bg,
  },
  hint: {
    color: colors.textMuted,
    ...type.small,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    textTransform: "none",
    letterSpacing: 0,
  },
  empty: { paddingTop: "28%", alignItems: "center", paddingHorizontal: space.xl },
  emptyTitle: { color: colors.text, ...type.heading, marginBottom: space.sm },
  emptySub: { color: colors.textMuted, ...type.body, textAlign: "center" },
});
