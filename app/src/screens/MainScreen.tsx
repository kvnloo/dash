import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { applyScopeMention, GlobalSearchBar } from "../components/GlobalSearchBar";
import { ConnectionPill } from "../components/ConnectionPill";
import { Header, HeaderTitle, IconButton } from "../components/Header";
import { SearchResultRow } from "../components/SearchResultRow";
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
  const [query, setQuery] = useState("");
  const conversations = store.use((s) => s.conversations);
  const harnesses = store.use((s) => s.connection.harnesses);
  const settings = store.use((s) => s.settings);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);

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

  const onScope = useCallback((label: string) => {
    haptic.tap();
    setQuery((q) => applyScopeMention(q, label));
  }, []);

  const newChat = useCallback(() => {
    haptic.tap();
    setActive(null);
    navigation.navigate("Chat");
  }, [navigation]);

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
        left={<IconButton icon="create-outline" label="New chat" onPress={newChat} />}
        center={<HeaderTitle>Dash</HeaderTitle>}
        right={<IconButton icon="options-outline" label="Settings" onPress={() => navigation.navigate("Settings")} />}
      />
      <ConnectionPill />
      <GlobalSearchBar value={query} onChange={setQuery} onScope={onScope} />
      {hint ? (
        <Text style={styles.hint} accessibilityRole="text">
          {hint}
        </Text>
      ) : null}
      <FlashList
        data={results}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptySub}>{emptyMessage}</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  hint: {
    color: colors.textMuted,
    ...type.small,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    textTransform: "none",
    letterSpacing: 0,
  },
  empty: { paddingTop: "36%", alignItems: "center", paddingHorizontal: space.xl },
  emptyTitle: { color: colors.text, ...type.heading, marginBottom: space.sm },
  emptySub: { color: colors.textMuted, ...type.body, textAlign: "center" },
});
