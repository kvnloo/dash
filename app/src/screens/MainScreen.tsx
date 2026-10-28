import { BlurTargetView } from "expo-blur";
import { Canvas } from "../components/Canvas";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Animated, { useSharedValue } from "react-native-reanimated";
import { Alert, InteractionManager, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MainPager, type MainPagerRef } from "../components/MainPager";
import { applyScopeMention, GlobalSearchBar } from "../components/GlobalSearchBar";
import { ConnectionPill } from "../components/ConnectionPill";
import { KeyboardDock } from "../components/KeyboardDock";
import { AppNav, type AppNavHandle } from "../components/AppNav";
import { SearchResultRow } from "../components/SearchResultRow";
import { BottomActionSheet } from "../components/BottomActionSheet";
import { SkeletonRow } from "../components/SkeletonRow";
import { useChatSearch } from "../hooks/useChatSearch";
import { resultRowModel, type SearchRowModel } from "../lib/chat-search";
import { projectsFromHosts } from "../lib/project-data";
import { isDebugActive } from "../debug/expose";
import { debugUi } from "../debug/ui-store";
import { haptic } from "../haptics";
import {
  formatSearchHint,
  parseSearchQuery,
  runGlobalSearch,
  visibleSearchResults,
  type SearchResult,
} from "../lib/global-search";
import { FEEDBACK_CONVERSATION_ID, inAppFeedbackEnabled, type FeedbackAction } from "../lib/feedback";
import { submitInAppFeedback } from "../lib/feedback-submit";
import { DEFAULT_MAIN_TAB } from "../lib/home";
import { composerTrigger } from "../lib/composer-suggestions";
import type { AgentTarget } from "../mock/agents";
import type { ScreenProps } from "../navigation";
import { createConversation, openAgentConversation, openChat, openListedConversation, saveSettings, setActive, store } from "../store/app";
import type { Conversation } from "../model";
import { colors, space, type } from "../theme";
import { HostsPane } from "./panes/HostsPane";
import { ChatsPane } from "./panes/ChatsPane";
import { OrchestraPane } from "./panes/OrchestraPane";

function feedbackFromSearch(item: SearchResult): FeedbackAction {
  switch (item.kind) {
    case "bot":
      return {
        kind: "select",
        text: `Selected bot ${item.bot.name}`,
        selection: { kind: "bot", id: item.bot.id, label: item.bot.name },
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

type SearchListItem =
  | { type: "header"; key: string; title: string }
  | { type: "row"; key: string; model: SearchRowModel }
  | { type: "more"; key: string; label: string; query: string };

const NO_RESULTS: SearchResult[] = [];

function isConversation(value: { id: string } & Partial<Conversation>): value is Conversation {
  return typeof value.harness === "string" && typeof value.title === "string" && Array.isArray(value.messages);
}

/**
 * Render a pane once it has been focused, or after the first idle callback after mount, so the
 * Main screen's first frame never pays for panes the owner is not looking at.
 */
function LazyPane({ focused, children }: { focused: boolean; children: ReactNode }) {
  const [ready, setReady] = useState(focused);
  useEffect(() => {
    if (ready) return;
    if (focused) { setReady(true); return; }
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, [focused, ready]);
  return ready ? <>{children}</> : null;
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
  const blurTarget = useRef<View>(null);
  const pagerRef = useRef<MainPagerRef>(null);
  const navRef = useRef<AppNavHandle>(null);
  const pagerProgress = useSharedValue(DEFAULT_MAIN_TAB);
  const routeTab = route.params?.tab;

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

  // Keyed on the params object: popTo("Main", { tab }) makes a new one per tap, so asking for
  // the tab Main already recorded (after the user swiped away) still moves the pager.
  const routeParams = route.params;
  useEffect(() => {
    if (typeof routeTab !== "number") return;
    setIndex(routeTab);
    pagerRef.current?.setPage(routeTab);
  }, [routeParams, routeTab, setIndex]);

  const onPage = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      setIndex(e.nativeEvent.position);
    },
    [setIndex],
  );

  const harnesses = store.use((s) => s.connection.harnesses);
  const hosts = store.use((s) => s.connection.hosts);
  const cwd = store.use((s) => s.connection.cwd);
  const settings = store.use((s) => s.settings);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const noTrigger = composerTrigger(query) === null;
  const chatScope = parsed.mode === "mention" && parsed.scope === "conversation" && noTrigger;
  // Plain text: a compact "Chats" section (local top 5, then the bridge's first page).
  const discoverChats = parsed.mode === "discover" && parsed.text.length >= 2 && noTrigger;
  const searchActive = (parsed.mode !== "discover" && parsed.scope !== "unknown" && noTrigger) || discoverChats;
  const globalActive = searchActive && !chatScope && !discoverChats;

  // Bots, products, /live and /harness only: built while that search is on screen.
  const conversations = store.use((s) => (globalActive ? s.conversations : undefined));
  const products = useMemo(
    () => (globalActive ? projectsFromHosts({ hosts, conversations: store.get().conversations, cwd, now: Date.now() }) : undefined),
    // Project rows are a roster view: rebuild with the roster, not with every chat update.
    [hosts, cwd, globalActive],
  );
  const results = useMemo(
    () => (globalActive && conversations ? visibleSearchResults(runGlobalSearch({ query, conversations, harnesses, hosts, cwd, products }), query) : NO_RESULTS),
    [globalActive, query, conversations, harnesses, hosts, cwd, products],
  );
  const chatSearch = useChatSearch(chatScope ? parsed.text : discoverChats ? parsed.text : "", {
    enabled: chatScope || discoverChats,
    localLimit: discoverChats ? 5 : 50,
    remoteLimit: discoverChats ? 10 : 20,
    minRemoteChars: discoverChats ? 2 : 1,
  });
  const listItems = useMemo((): SearchListItem[] => {
    if (discoverChats) {
      const rows = chatSearch.rows.slice(0, 15);
      return [
        { type: "header", key: "chats-header", title: "Chats" },
        ...rows.map((model): SearchListItem => ({ type: "row", key: model.key, model })),
        { type: "more", key: "chats-more", label: `See all chats matching “${parsed.text}”`, query: `@chats ${parsed.text}` },
      ];
    }
    if (chatScope) return chatSearch.rows.map((model): SearchListItem => ({ type: "row", key: model.key, model }));
    return results.map((item): SearchListItem => ({ type: "row", key: item.key, model: resultRowModel(item) }));
  }, [discoverChats, chatScope, chatSearch.rows, results, parsed.text]);

  const hint = formatSearchHint(parsed);

  const openHarness = useCallback(
    (harnessId: string, draft?: string) => {
      if (!harnessId) return;
      haptic.select();
      if (settings) saveSettings({ ...settings, harness: harnessId });
      const existing = store.get().conversations.find((c) => c.harness === harnessId && !c.targetHostId && !c.sessionId);
      if (existing) setActive(existing.id);
      else createConversation(harnessId);
      navigation.navigate("Chat", draft ? { draft } : undefined);
    },
    [navigation, settings],
  );

  const openBot = useCallback(
    (profile: AgentTarget) => {
      const result = openAgentConversation(profile);
      if ("error" in result) {
        Alert.alert("Agent unavailable", result.error);
        return;
      }
      haptic.select();
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const openConversation = useCallback(
    (conversation: { id: string } & Partial<Conversation>) => {
      haptic.select();
      const known = store.get().conversations.some((c) => c.id === conversation.id);
      // A listed live row the roster did not adopt (chats.v1 adopts running rows only) opens now.
      if (!known && isConversation(conversation)) openListedConversation(conversation);
      else setActive(conversation.id);
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
          if (item.target) openBot(item.target);
          else Alert.alert(item.bot.name, `${item.subtitle}.\n\nDash cannot open a chat with this bot from here. Message it on its own platform.`);
          break;
        case "conversation":
          openConversation(item.conversation);
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

  const onRow = useCallback(
    (model: SearchRowModel) => {
      if (model.result) { onResult(model.result); return; }
      if (model.conversationId) { openConversation({ id: model.conversationId }); return; }
      if (model.summary) {
        haptic.select();
        openChat(model.summary);
        navigation.navigate("Chat");
      }
    },
    [navigation, onResult, openConversation],
  );

  const onFeedbackRow = useCallback(
    (model: SearchRowModel) => {
      if (model.result) { onFeedbackResult(model.result); return; }
      if (!inAppFeedbackEnabled(store.get().settings)) return;
      haptic.select();
      const id = model.conversationId ?? model.key;
      submitInAppFeedback({ kind: "select", text: `Selected chat ${model.title}`, selection: { kind: "chat", id, label: model.title || id } });
      navigation.navigate("Chat");
    },
    [navigation, onFeedbackResult],
  );

  // Long-press opens a menu; feedback (which sends a message) only on an explicit choice.
  const [rowMenu, setRowMenu] = useState<SearchRowModel | null>(null);
  const onRowMenu = useCallback((model: SearchRowModel) => { haptic.select(); setRowMenu(model); }, []);
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  const rowMenuOptions = useMemo(() => [
    { id: "open", label: "Open", accessibilityLabel: `Open ${rowMenu?.title || "result"}`, destructive: false },
    { id: "feedback", label: "Send feedback about this", accessibilityLabel: `Send feedback about ${rowMenu?.title || "result"}`, destructive: false },
  ], [rowMenu]);
  const onRowMenuSelect = useCallback((choice: string) => {
    const model = rowMenu;
    setRowMenu(null);
    if (!model) return;
    if (choice === "open") onRow(model);
    else if (choice === "feedback") onFeedbackRow(model);
  }, [rowMenu, onRow, onFeedbackRow]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SearchListItem | undefined>) => {
      if (!item) return null;
      if (item.type === "header") return <Text style={styles.sectionHeader}>{item.title}</Text>;
      if (item.type === "more") {
        return (
          <Pressable accessibilityRole="button" onPress={() => { haptic.tap(); setQuery(item.query); }} style={styles.more}>
            <Text style={styles.moreText} numberOfLines={1}>{item.label}</Text>
          </Pressable>
        );
      }
      return <SearchResultRow model={item.model} onPress={onRow} onLongPress={feedbackOn ? onRowMenu : undefined} />;
    },
    [feedbackOn, onRowMenu, onRow, setQuery],
  );
  // FlashList asks for the type at indices of the list it last laid out. Typing (or Send, which
  // clears the query) shrinks the data first, so an index can be past the end: never throw there.
  const getItemType = useCallback((item: SearchListItem | undefined) => item?.type ?? "row", []);
  const searchKey = useCallback((item: SearchListItem | undefined, index: number) => item?.key ?? `missing-${index}`, []);
  const searchFooter = (chatScope || discoverChats) && chatSearch.status === "loading"
    ? <View>{[0, 1].map(i => <SkeletonRow key={i} />)}</View>
    : chatScope && chatSearch.partial && chatSearch.hasMore
      ? <Pressable accessibilityRole="button" onPress={chatSearch.loadMore} style={styles.more}><Text style={styles.moreText}>Keep searching older messages</Text></Pressable>
      : null;

  const emptyMessage =
    parsed.mode === "slash" && parsed.scope === "unknown"
      ? `Unknown /${parsed.rawScope}. Pick /live, /harness, /skill, /plugin, /tool, or /file.`
      : parsed.mode === "mention" && parsed.scope === "unknown"
        ? `Unknown @${parsed.rawScope}. Pick @bots, @conversation, or @product.`
        : parsed.mode === "slash"
          ? parsed.scope === "skill" || parsed.scope === "plugin" || parsed.scope === "tool" || parsed.scope === "file"
            ? `The bridge does not report ${parsed.scope} inventory yet.`
            : "No live sessions or installed harnesses match."
          : "No matches. Use @ for bots and chats, / for harness files and tools.";

  // Stable pager children: a MainScreen render (typing, search state) must not cascade into the
  // three panes; each pane subscribes to the store slices it needs on its own.
  const pages = useMemo(() => [
    <View key="hosts" style={{ width, flex: 1 }}>
      <LazyPane focused={index === 0}><HostsPane navigation={navigation} focused={index === 0} /></LazyPane>
    </View>,
    <View key="chats" style={{ width, flex: 1 }}>
      <ChatsPane navigation={navigation} focused={index === 1 && !searchActive} />
    </View>,
    <View key="orchestra" style={{ width, flex: 1 }}>
      <LazyPane focused={index === 2}><OrchestraPane navigation={navigation} /></LazyPane>
    </View>,
  ], [navigation, index, searchActive, width]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}><Canvas />
      <AppNav
        ref={navRef}
        navigation={navigation}
        tab={index}
        progress={pagerProgress}
        onTab={(next) => {
          pagerRef.current?.setPage(next);
        }}
      />
      <WorkspaceHeader navigation={navigation} tab={index} titleOnly={index === 2} />
      <ConnectionPill />
      <BlurTargetView ref={blurTarget} style={styles.body}>
        {searchActive ? (
          <>
            {hint ? (
              <Text style={styles.hint} accessibilityRole="text">
                {hint}
              </Text>
            ) : null}
            <FlashList
              data={listItems}
              renderItem={renderItem}
              getItemType={getItemType}
              keyExtractor={searchKey}
              drawDistance={600}
              onEndReached={chatScope ? chatSearch.loadMore : undefined}
              onEndReachedThreshold={0.5}
              ListFooterComponent={searchFooter}
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
          <Animated.View style={styles.pager} collapsable={false}>
            <MainPager
              ref={pagerRef}
              style={styles.pager}
              page={index}
              initialPage={index}
              onPageSelected={onPage}
              progress={pagerProgress}
              pageWidth={width}
            >
              {pages}
            </MainPager>
          </Animated.View>
        )}
      </BlurTargetView>

      <BottomActionSheet open={rowMenu !== null} title={rowMenu?.title || "Result"} options={rowMenuOptions} onSelect={onRowMenuSelect} onClose={closeRowMenu} />
      <KeyboardDock style={styles.searchDock}>
        <GlobalSearchBar
          value={query}
          blurTarget={blurTarget}
          onChange={setQuery}
          onScope={onScope}
          dock="bottom"
          placeholder={feedbackOn ? "Feedback for Dash" : "Search or message Dash"}
          onVoice={() => {
            // Voice keeps the explicitly attached chat; never retarget via a new feedback chat.
            navigation.navigate("Voice", { autostart: true });
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
    backgroundColor: "transparent",
  },
  sectionHeader: { color: colors.textMuted, ...type.label, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  more: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.lg },
  moreText: { color: colors.gold, ...type.label },
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
