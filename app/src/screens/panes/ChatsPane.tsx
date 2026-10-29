import { useIsFocused } from "@react-navigation/native";
import { useHandedness } from "../../lib/useHandedness";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { chatKey, type ChatSummary, type HostInfo } from "../../../../shared/protocol";
import type { WindowOrigin } from "../../lib/chat-window";
import { threadAppearance } from "../../components/thread-appearance";
import { AgentOrb } from "../../components/AgentOrb";
import { ShimmerText } from "../../components/ShimmerText";
import { activityShimmerEnabled } from "../../lib/activity-shimmer";
import { CHAT_ROW_HEIGHT, SECTION_ROW_HEIGHT, SkeletonRow } from "../../components/SkeletonRow";
import { conversationThinking, type Thinking } from "../../lib/thinking";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { chatRow } from "../../lib/chat-row";
import { chatRowActions, chatRowMenu, pressRow, runChatRowMenu } from "../../lib/chat-row-actions";
import { BottomActionSheet } from "../../components/BottomActionSheet";
import { NextActionCard } from "../../components/NextActionCard";
import { ChatListControls } from "../../components/ChatListControls";
import { DEFAULT_CHAT_FILTERS, filterChatRows, historyNeeded, projectPath, type ChatFilters } from "../../lib/chat-filters";
import { conversationEntries, emptyList, groupLabeler, labelList, listRows, mergeLocal, stableEntries, type ChatListRow, type ConversationEntry, type RemoteLabeled } from "../../lib/chat-index";
import { FEEDBACK_CONVERSATION_ID, inAppFeedbackEnabled } from "../../lib/feedback";
import { nextAction } from "../../lib/next-action";
import { NEXT_ACTION_LATER_MS } from "../../lib/next-action-card";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import { usePagedChats } from "../../hooks/usePagedChats";
import type { ConnectionStatus, Conversation } from "../../model";
import type { ScreenProps } from "../../navigation";
import { clearEndedConversations, deleteConversation, openChat, setActive, store } from "../../store/app";
import { summaryByKey } from "../../store/chat-index-store";
import { composerDrafts } from "../../store/composer-drafts";
import {
  dismissNextAction,
  initializeReplySeen,
  nextActionPreferences,
  snoozeNextAction,
} from "../../store/next-action-preferences";
import { permissionRequests } from "../../net/bridge";
import { colors, space, type } from "../../theme";
import { confirmDestructive, timeAgo } from "../../util";

/** Everything a row renders, built once per conversation revision or summary object. */
interface ChatRowModel {
  /** Conversation id for phone chats, summary key for chats not opened yet. */
  id: string;
  harnessName: string;
  content: ReturnType<typeof chatRow>;
  thinking: Thinking;
  stale: boolean;
  updatedAt: number;
  openIn?: string;
  /** Badge for chats Dash can read but not send to. */
  viewOnly: boolean;
  /** Host name when the chat is not on the paired computer. */
  hostName?: string;
}

const localModels = new WeakMap<Conversation, { harnessName: string; connectionStatus: ConnectionStatus; model: ChatRowModel }>();
function localModel(item: Conversation, harnessName: string, connectionStatus: ConnectionStatus): ChatRowModel {
  const cached = localModels.get(item);
  if (cached && cached.harnessName === harnessName && cached.connectionStatus === connectionStatus) return cached.model;
  const model: ChatRowModel = {
    id: item.id, harnessName, content: chatRow(item, harnessName, connectionStatus),
    thinking: item.stale ? { phase: "idle" } : conversationThinking(item.messages, connectionStatus),
    stale: item.stale === true, updatedAt: item.updatedAt, ...(item.openIn ? { openIn: item.openIn } : {}), viewOnly: false,
  };
  localModels.set(item, { harnessName, connectionStatus, model });
  return model;
}

const remoteModels = new WeakMap<ChatSummary, { harnessName: string; selfId: string | undefined; model: ChatRowModel }>();
function remoteModel(summary: ChatSummary, harnessName: string, selfId: string | undefined): ChatRowModel {
  const cached = remoteModels.get(summary);
  if (cached && cached.harnessName === harnessName && cached.selfId === selfId) return cached.model;
  const cwd = summary.cwd?.trim();
  const folderName = cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
  const foreign = summary.hostId !== selfId;
  const model: ChatRowModel = {
    id: summary.key, harnessName,
    content: {
      title: summary.title.trim() || harnessName,
      folder: folderName ? `Folder · ${folderName}` : "Folder unknown",
      folderPath: cwd || undefined,
      outcome: `${summary.messageCount} message${summary.messageCount === 1 ? "" : "s"} · ${harnessName}${foreign ? ` · ${summary.hostName}` : ""}`,
      outcomeLabel: null,
      activity: summary.running ? "Running on host" : summary.openIn ? `Open in ${summary.openIn}` : "Not opened yet",
      needsAttention: false,
    },
    thinking: { phase: "idle" }, stale: false, updatedAt: summary.lastActivityAt, ...(summary.openIn ? { openIn: summary.openIn } : {}),
    viewOnly: !summary.chatable, ...(foreign ? { hostName: summary.hostName } : {}),
  };
  remoteModels.set(summary, { harnessName, selfId, model });
  return model;
}

/** id -> conversation, built once per conversations array and shared by every mounted row. */
const byIdCache = new WeakMap<readonly Conversation[], Map<string, Conversation>>();
function conversationById(conversations: readonly Conversation[], id: string): Conversation | undefined {
  let map = byIdCache.get(conversations);
  if (!map) {
    map = new Map();
    for (const c of conversations) map.set(c.id, c);
    byIdCache.set(conversations, map);
  }
  return map.get(id);
}

/** Running and host-held sessions, keyed like the index. Built once per roster revision. */
function liveKeySet(hosts: HostInfo[]): Set<string> {
  const keys = new Set<string>();
  for (const host of hosts) {
    if (!host.online) continue;
    for (const agent of host.agents) {
      if (!agent.sessionId || agent.status !== "running") continue;
      keys.add(chatKey({ hostId: host.id, kind: agent.kind, sessionId: agent.sessionId, ...(agent.kind === "hermes" && agent.profileId ? { profileId: agent.profileId } : {}) }));
      keys.add(`any:${agent.kind}:${agent.sessionId}`);
    }
  }
  return keys;
}

const Row = memo(function Row({
  item,
  active,
  connectionStatus,
  live = false,
  onPress,
  onLongPress,
}: {
  item: ChatRowModel;
  active: boolean;
  connectionStatus: ConnectionStatus;
  live?: boolean;
  onPress(id: string, origin?: WindowOrigin): void;
  onLongPress(id: string): void;
}) {
  const appearance = threadAppearance({ stale: item.stale, live });
  const stale = appearance.stale;
  const thinking = item.thinking;
  const content = item.content;
  const activityShimmer = activityShimmerEnabled(thinking.phase, connectionStatus, stale);
  return (
    <PressScale
      onPress={(event) => pressRow(event.nativeEvent, CHAT_ROW_HEIGHT, item.id, onPress)}
      onLongPress={() => onLongPress(item.id)}
      delayLongPress={350}
      style={[styles.row, active && !stale && styles.rowActive]}
      accessibilityRole="button"
      testID={`chat-row-${item.id}`}
    >
      <AgentOrb size={28} thinking={thinking} label={`${item.harnessName} · ${thinking.tool ?? thinking.phase}`} />
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, stale && styles.stale]} numberOfLines={1}>
            {content.title}
          </Text>
          {appearance.live && connectionStatus === "online" ? <View accessibilityLabel="Live on host" style={styles.liveDot} /> : null}
          {item.viewOnly ? <Text style={styles.badge} accessibilityLabel="View only">view only</Text> : null}
          <Text style={styles.rowTime} numberOfLines={1}>{stale ? "ended" : item.openIn ? `${item.openIn} · ${timeAgo(item.updatedAt)}` : timeAgo(item.updatedAt)}</Text>
        </View>
        <View style={styles.rowMeta}>
          <Text style={styles.rowFolder} numberOfLines={1} accessibilityLabel={content.folderPath ? `Working folder: ${content.folderPath}` : content.folder}>
            {content.folder}
          </Text>
          {activityShimmer ? <View style={styles.rowActivityHighlight}>
            <ShimmerText text={content.activity} size={12} family="sans-serif" dim={colors.textMuted} bright={colors.text} />
          </View> : <Text style={[styles.rowActivity, content.needsAttention && styles.attention]} numberOfLines={1}>
            {content.activity}
          </Text>}
        </View>
        <Text style={[styles.rowPreview, stale && styles.stale]} numberOfLines={1}>
          {content.outcomeLabel ? `${content.outcomeLabel} · ` : ""}{content.outcome}
        </Text>
      </View>
      <View style={styles.hairline} />
    </PressScale>
  );
}, (a, b) => a.item === b.item && a.live === b.live && a.active === b.active && a.connectionStatus === b.connectionStatus && a.onPress === b.onPress && a.onLongPress === b.onLongPress);

/**
 * A phone conversation's row. It reads its conversation live by id, so its title, activity and
 * thinking orb follow every turn event while the merged list (and FlashList's data) stays put.
 */
const LocalChatRow = memo(function LocalChatRow({ id, harnessName, connectionStatus, active, live, onPress, onLongPress }: {
  id: string;
  harnessName: string;
  connectionStatus: ConnectionStatus;
  active: boolean;
  live: boolean;
  onPress(id: string, origin?: WindowOrigin): void;
  onLongPress(id: string): void;
}) {
  const conversation = store.use((s) => conversationById(s.conversations, id));
  if (!conversation) return null;
  return (
    <Row
      item={localModel(conversation, harnessName, connectionStatus)}
      active={active}
      connectionStatus={connectionStatus}
      live={live}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );
});

const SectionHeader = memo(function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text><Text style={styles.rowTime}>{count}</Text>
    </View>
  );
});

const SKELETONS: ChatListRow[] = Array.from({ length: 6 }, (_, i) => ({ type: "skeleton", key: `skeleton-${i}` }));

/** Start of the local day: the section labeler is rebuilt once a day, not per merge. */
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const NO_ENTRIES: readonly ConversationEntry[] = [];
const NO_LIST = emptyList();

export const ChatsPane = memo(function ChatsPane({ navigation, focused = false }: Pick<ScreenProps<"Main">, "navigation"> & { focused?: boolean }) {
  const thumb = useHandedness();
  const screenFocused = useIsFocused();
  const conversations = store.use((s) => s.conversations);
  const hydrated = store.use((s) => s.hydrated);
  const activeId = store.use((s) => s.activeId);
  const harnesses = store.use((s) => s.connection.harnesses);
  const connectionStatus = store.use((s) => s.connection.status);
  const hosts = store.use((s) => s.connection.hosts);
  const hasEnded = store.useSelector((s) => s.conversations.some(c => c.stale));
  const [filters, setFilters] = useState<ChatFilters>(DEFAULT_CHAT_FILTERS);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const remote = usePagedChats(filters.harness ? { kinds: [filters.harness] } : {}, { focused, online: connectionStatus === "online" });

  const previousLocal = useRef<readonly ConversationEntry[]>(NO_ENTRIES);
  const local = useMemo(() => {
    const next = conversationEntries(conversations);
    previousLocal.current = filters.sort === "priority" && filters.date === "all" ? stableEntries(previousLocal.current, next) : next;
    return previousLocal.current;
  }, [conversations, filters.sort, filters.date]);
  const today = startOfToday();
  const groupOf = useMemo(() => groupLabeler(today), [today]);
  // The remote half is labeled incrementally: an appended page labels only its own rows and a head
  // refresh replays only the rows it changed. A local change merges the few local rows into it by
  // binary search.
  const previousLabeled = useRef<RemoteLabeled | undefined>(undefined);
  const remoteList = remote.list ?? NO_LIST;
  const labeled = useMemo(() => {
    previousLabeled.current = labelList(remoteList, groupOf, previousLabeled.current);
    return previousLabeled.current;
  }, [remoteList, groupOf]);
  const liveKeys = useMemo(() => liveKeySet(hosts), [hosts]);
  const selfId = useMemo(() => hosts.find(host => host.self)?.id, [hosts]);
  const harnessNames = useMemo(() => new Map(harnesses.map(h => [h.id, h.name])), [harnesses]);
  const summaries = useMemo(() => listRows(remoteList), [remoteList]);
  const needsHistory = historyNeeded(filters, summaries, today);
  const withinDateRange = filters.date === "all" || needsHistory;
  const scanning = remote.enabled && !remote.exhausted && withinDateRange && (projectsOpen || needsHistory);
  useEffect(() => {
    if (scanning && focused && connectionStatus === "online" && remote.status === "ready" && !remote.loadingMore && !remote.error) remote.loadMore();
  }, [scanning, focused, connectionStatus, remote.status, remote.loadingMore, remote.error, remote.list, remote.loadMore]);
  const filtered = filters.harness !== null || filters.project !== null || filters.date !== "all" || filters.sort !== "recent";
  const items = useMemo((): ChatListRow[] => {
    const rows = mergeLocal(labeled, { local, exhausted: remote.exhausted || filtered, endedLast: !remote.enabled, groupOf });
    if (rows.length === 0 && remote.enabled && remote.status === "loading") return SKELETONS;
    return filterChatRows(rows, filters, today, liveKeys);
  }, [labeled, local, groupOf, remote.exhausted, remote.enabled, remote.status, filtered, filters, today, liveKeys]);
  // Placeholder cells and real rows must not share a recycler/layout manager.
  // Ordinary live updates keep the same instance and its visible-content anchor.
  const listLifecycleKey = `${JSON.stringify(filters)}:${items === SKELETONS ? "loading" : "ready"}`;
  const count = useMemo(() => items.reduce((total, row) => total + (row.type === "chat" ? 1 : 0), 0), [items]);
  const filterOptions = useMemo(() => {
    const kinds = new Set(harnesses.map(h => h.id));
    const projects = new Set<string>();
    for (const entry of local) {
      kinds.add(entry.harness);
      const path = projectPath(entry.cwd);
      if (path) projects.add(path);
    }
    for (const summary of summaries) {
      kinds.add(summary.kind);
      const path = projectPath(summary.cwd);
      if (path) projects.add(path);
    }
    if (filters.harness) kinds.add(filters.harness);
    if (filters.project) projects.add(filters.project);
    return {
      harnesses: [...kinds].map(id => ({ id, label: harnessNames.get(id) ?? id })).sort((a, b) => a.label.localeCompare(b.label)),
      projects: [...projects].sort((a, b) => a.localeCompare(b)),
    };
  }, [harnesses, local, summaries, harnessNames, filters.harness, filters.project]);
  const actions = useMemo(() => chatRowActions({
    select: () => haptic.select(),
    // A row not opened on this phone yet becomes a conversation only now (or opens view-only).
    setActive: (id: string) => {
      const summary = store.get().conversations.some(c => c.id === id) ? undefined : summaryByKey(id);
      if (summary) openChat(summary); else setActive(id);
    },
    navigate: (route, params) => navigation.navigate(route, params),
    confirm: confirmDestructive,
    remove: deleteConversation,
  }), [navigation]);
  const open = actions.open;
  const remove = actions.remove;

  const drafts = composerDrafts.use(all => all);
  const permissionRecords = permissionRequests.state.use(state => state.records);
  const preferences = nextActionPreferences.use(state => state);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const listener = AppState.addEventListener("change", state => setAppActive(state === "active"));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!focused || !screenFocused || !appActive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [focused, screenFocused, appActive]);
  useEffect(() => {
    if (!hydrated || !preferences.restored || preferences.initialized) return;
    const seen: Record<string, number> = {};
    for (const chat of conversations) {
      const latest = chat.messages.at(-1);
      if (latest?.role === "assistant" && latest.state === "done") {
        seen[chat.id] = latest.at;
      }
      else if (chat.messages.length === 0) seen[chat.id] = chat.updatedAt;
    }
    initializeReplySeen(seen);
  }, [conversations, hydrated, preferences.initialized, preferences.restored]);
  const attention = useMemo(() => {
    if (!preferences.restored || !preferences.initialized) return null;
    const hidden = new Set(Object.keys(preferences.dismissed));
    for (const [id, snooze] of Object.entries(preferences.snoozed)) {
      if (snooze.until > now) hidden.add(id);
    }
    const draftText: Record<string, string> = {};
    for (const [id, draft] of Object.entries(drafts)) draftText[id] = draft.text;
    return nextAction({
      conversations: conversations.filter(chat => chat.id !== FEEDBACK_CONVERSATION_ID && (chat.openedAt !== undefined || !chat.id.startsWith("live:"))),
      permissions: Object.values(permissionRecords),
      draftTextByConversation: draftText,
      now,
      dismissed: hidden,
      lastSeen: preferences.lastSeen,
    });
  }, [conversations, drafts, now, permissionRecords, preferences]);
  const attentionHeader = attention ? (
    <View style={styles.nextUp}>
      <Text style={styles.nextUpLabel}>Next up</Text>
      <NextActionCard
        action={attention}
        onDo={action => open(action.conversationId)}
        onLater={action => snoozeNextAction(action.id, Date.now() + NEXT_ACTION_LATER_MS)}
        onSkip={action => dismissNextAction(action.id, Date.now())}
      />
    </View>
  ) : null;

  const onFeedback = useCallback(
    (id: string) => {
      if (!inAppFeedbackEnabled(store.get().settings)) return;
      const conversation = store.get().conversations.find((c) => c.id === id);
      haptic.select();
      submitInAppFeedback({
        kind: "select",
        text: `Selected chat ${conversation?.title ?? id}`,
        selection: { kind: "chat", id, label: conversation?.title || id },
      });
      navigation.navigate("Chat");
    },
    [navigation],
  );

  const feedbackOn = inAppFeedbackEnabled(store.use((s) => s.settings));
  // Long-press only opens the row menu; every action (including feedback, which sends) is an explicit choice.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const longPress = useCallback((id: string) => { haptic.select(); setMenuFor(id); }, []);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const menuTitle = menuFor ? store.get().conversations.find((c) => c.id === menuFor)?.title ?? summaryByKey(menuFor)?.title ?? "" : "";
  const menu = useMemo(() => chatRowMenu(feedbackOn, menuTitle), [feedbackOn, menuTitle]);
  const onMenu = useCallback((choice: string) => {
    const id = menuFor;
    setMenuFor(null);
    if (id) runChatRowMenu(choice, id, { open: (rowId) => open(rowId), feedback: onFeedback, remove });
  }, [menuFor, open, onFeedback, remove]);

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<ChatListRow | undefined>) => {
      if (!row) return null;
      if (row.type === "section") return <SectionHeader title={row.title} count={row.count} />;
      if (row.type === "skeleton") return <SkeletonRow />;
      const local = row.local;
      const summary = row.remote;
      const harness = local?.harness ?? summary?.kind ?? "";
      const harnessName = harnessNames.get(harness) ?? harness;
      if (local) {
        const sessionId = local.sessionId;
        const live = liveKeys.has(local.key) || Boolean(sessionId && !local.hostId && liveKeys.has(`any:${local.harness}:${sessionId}`));
        return (
          <LocalChatRow
            id={local.id}
            harnessName={harnessName}
            connectionStatus={connectionStatus}
            active={local.id === activeId}
            live={live}
            onPress={open}
            onLongPress={longPress}
          />
        );
      }
      if (!summary) return null;
      const model = remoteModel(summary, harnessName, selfId);
      return (
        <Row
          item={model}
          active={model.id === activeId}
          connectionStatus={connectionStatus}
          live={summary.running === true || liveKeys.has(row.key)}
          onPress={open}
          onLongPress={longPress}
        />
      );
    },
    [activeId, connectionStatus, harnessNames, liveKeys, longPress, open, selfId],
  );

  // FlashList can ask about an index past the end of a list that just shrank: never throw there.
  const getItemType = useCallback((item: ChatListRow | undefined) => item?.type ?? "chat", []);
  const keyExtractor = useCallback((item: ChatListRow | undefined, index: number) => item?.key ?? `missing-${index}`, []);
  const loadMore = remote.loadMore;
  const footer = remote.loadingMore || (remote.status === "loading" && items !== SKELETONS && items.length > 0)
    ? <View>{[0, 1, 2].map(i => <SkeletonRow key={i} />)}</View>
    : remote.error && remote.enabled
      ? <PressScale onPress={remote.loadingMore ? undefined : remote.loaded ? loadMore : remote.refresh} accessibilityRole="button" style={styles.retry}>
        <Text style={styles.retryText}>{remote.error} · Retry</Text>
      </PressScale>
      : null;

  return (
    <View style={styles.wrap} testID="chats-pane">
      <ChatListControls filters={filters} harnesses={filterOptions.harnesses} projects={filterOptions.projects} onChange={setFilters} onProjectsOpen={setProjectsOpen} loading={scanning && focused && connectionStatus === "online" && !remote.error} count={count} />
      {hasEnded && (
        <PressScale onPress={() => confirmDestructive("Clear ended chats?", "Saved history is removed from this phone only.", "Clear ended", clearEndedConversations)} accessibilityRole="button" style={[styles.clearEnded, thumb.align]}>
          <Text style={styles.clearEndedText}>Clear ended</Text>
        </PressScale>
      )}
      <BottomActionSheet open={menuFor !== null} title={menu.title} options={menu.options} onSelect={onMenu} onClose={closeMenu} />
      <FlashList
        key={listLifecycleKey}
        data={items}
        renderItem={renderItem}
        getItemType={getItemType}
        keyExtractor={keyExtractor}
        extraData={`${activeId}:${connectionStatus}`}
        drawDistance={600}
        onEndReached={withinDateRange && focused && connectionStatus === "online" ? loadMore : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={footer}
        ListHeaderComponent={attentionHeader}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{scanning && !remote.error ? connectionStatus === "online" ? "Searching chat history…" : "Connect to search older chats" : filtered ? "No matching chats" : "No chats yet"}</Text>
            {filtered && <PressScale onPress={() => setFilters(DEFAULT_CHAT_FILTERS)} accessibilityRole="button" style={styles.retry}><Text style={styles.retryText}>Reset filters</Text></PressScale>}
          </View>
        }
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  section: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: space.lg,
    height: SECTION_ROW_HEIGHT,
    paddingTop: space.xs,
  },
  sectionTitle: { color: colors.textMuted, ...type.label },
  attention: { color: colors.danger },
  nextUp: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs, gap: space.xs },
  nextUpLabel: { color: colors.gold, ...type.label },
  clearEnded: { paddingHorizontal: space.lg, paddingTop: space.sm, minHeight: 44, justifyContent: "center" },
  clearEndedText: { color: colors.gold, ...type.label },
  retry: { paddingHorizontal: space.lg, minHeight: 44, justifyContent: "center" },
  retryText: { color: colors.gold, ...type.label },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    height: CHAT_ROW_HEIGHT,
    paddingVertical: 5,
    overflow: "hidden",
  },
  rowActive: { backgroundColor: "rgba(215,185,134,.035)" },
  stale: { color: colors.textTertiary },
  liveDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.gold },
  badge: { color: colors.textTertiary, ...type.mono, fontSize: 10, textTransform: "none", letterSpacing: 0 },
  // PressScale applies padding on its outer Pressable and lays children out in an inner view,
  // so the divider must sit below that padding, not on the inner view's bottom edge.
  hairline: { position: "absolute", left: 52, right: 0, bottom: -5, height: StyleSheet.hairlineWidth, backgroundColor: colors.hair },
  rowMain: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rowTitle: { color: colors.text, ...type.heading, flex: 1 },
  rowTime: { color: colors.textTertiary, ...type.mono, textTransform: "none", letterSpacing: 0 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs },
  rowFolder: { color: colors.goldLo, ...type.mono, flex: 1, minWidth: 0 },
  rowActivity: { color: colors.textTertiary, ...type.label, flexShrink: 1, maxWidth: "55%" },
  rowActivityHighlight: { flex: 1, flexShrink: 1, minWidth: 0, maxWidth: "55%" },
  rowPreview: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  empty: { paddingTop: "40%", alignItems: "center" },
  emptyText: { color: colors.textMuted, ...type.body },
});
