import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MainPager, type MainPagerRef } from "../components/MainPager";
import { applyScopeMention, GlobalSearchBar } from "../components/GlobalSearchBar";
import { ConnectionPill } from "../components/ConnectionPill";
import { Header, IconButton } from "../components/Header";
import { SearchResultRow } from "../components/SearchResultRow";
import { TopTabs } from "../components/TopTabs";
import { isDebugActive } from "../debug/expose";
import { debugUi } from "../debug/ui-store";
import { haptic } from "../haptics";
import {
  formatSearchHint,
  parseSearchQuery,
  runGlobalSearch,
  type SearchResult,
} from "../lib/global-search";
import type { BotProfile } from "../mock/bots";
import type { ScreenProps } from "../navigation";
import { createConversation, saveSettings, setActive, store } from "../store/app";
import { colors, space, type } from "../theme";
import { BotsPane } from "./panes/BotsPane";
import { ChatsPane } from "./panes/ChatsPane";
import { OrchestraPane } from "./panes/OrchestraPane";

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

export function MainScreen({ navigation }: ScreenProps<"Main">) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pagerRef = useRef<MainPagerRef>(null);

  const debugSearch = debugUi.use((s) => s.mainSearchQuery);
  const debugTab = debugUi.use((s) => s.mainTabIndex);
  const [localQuery, setLocalQuery] = useState("");
  const [localTab, setLocalTab] = useState(1);
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

  const onTab = useCallback(
    (next: number) => {
      setIndex(next);
      pagerRef.current?.setPage(next);
    },
    [setIndex],
  );

  const onPage = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      setIndex(e.nativeEvent.position);
    },
    [setIndex],
  );

  const conversations = store.use((s) => s.conversations);
  const harnesses = store.use((s) => s.connection.harnesses);
  const settings = store.use((s) => s.settings);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const searchActive = query.trim().length > 0 || parsed.mode !== "discover";

  const results = useMemo(
    () => runGlobalSearch({ query, conversations, harnesses }),
    [query, conversations, harnesses],
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
      setActive(id);
      navigation.navigate("Chat");
    },
    [navigation],
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

  const onScope = useCallback(
    (label: string) => {
      haptic.tap();
      setQuery((q) => applyScopeMention(q, label));
    },
    [setQuery],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchResult>) => <SearchResultRow item={item} onPress={onResult} />,
    [onResult],
  );

  const emptyMessage =
    parsed.mode === "slash" && parsed.scope === "unknown"
      ? `Unknown /${parsed.rawScope}. Pick /harness, /skill, /plugin, /tool, or /file.`
      : parsed.mode === "mention" && parsed.scope === "unknown"
        ? `Unknown @${parsed.rawScope}. Pick @bots, @conversation, or @product.`
        : parsed.mode === "slash"
          ? "No laptop resources match. Try another keyword or scope."
          : "No matches. Use @ for bots and chats, / for harness files and tools.";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header
        left={
          <IconButton
            icon="create-outline"
            label="New chat"
            onPress={() => {
              haptic.tap();
              setActive(null);
              navigation.navigate("Chat");
            }}
          />
        }
        center={<TopTabs index={index} onChange={onTab} />}
        right={<IconButton icon="options-outline" label="Settings" onPress={() => navigation.navigate("Settings")} />}
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
          <MainPager ref={pagerRef} style={styles.pager} page={index} initialPage={index} onPageSelected={onPage} overdrag>
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
        )}
      </View>

      <View style={[styles.searchDock, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <GlobalSearchBar value={query} onChange={setQuery} onScope={onScope} dock="bottom" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  pager: { flex: 1 },
  searchDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
