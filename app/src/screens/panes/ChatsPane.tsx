import { useHandedness } from "../../lib/useHandedness";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import { memo, useCallback, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { chatKey, type ChatSummary, type HostInfo } from "../../../../shared/protocol";
import type { WindowOrigin } from "../../lib/chat-window";
import { threadAppearance } from "../../components/thread-appearance";
import { AgentOrb } from "../../components/AgentOrb";
import { CHAT_ROW_HEIGHT, SECTION_ROW_HEIGHT, SkeletonRow } from "../../components/SkeletonRow";
import { conversationThinking, type Thinking } from "../../lib/thinking";
import { PressScale } from "../../components/PressScale";
import { haptic } from "../../haptics";
import { chatRow } from "../../lib/chat-row";
import { chatRowActions, pressRow, rowLongPress } from "../../lib/chat-row-actions";
import { conversationEntries, emptyList, groupLabeler, labelList, mergeLocal, stableEntries, type ChatListRow, type ConversationEntry, type RemoteLabeled } from "../../lib/chat-index";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import { usePagedChats } from "../../hooks/usePagedChats";
import type { ConnectionStatus, Conversation } from "../../model";
import type { ScreenProps } from "../../navigation";
import { clearEndedConversations, deleteConversation, openChat, setActive, store } from "../../store/app";
import { summaryByKey } from "../../store/chat-index-store";
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
  const frame = useRef<View>(null);
  // What the agent is doing now, as a thinking-orbs orb (idle orbs hold still).
  const thinking = item.thinking;
  const press = () => pressRow(frame.current, item.id, onPress);
  const content = item.content;
  return (
    <View ref={frame} collapsable={false}>
    <PressScale
      onPress={press}
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
          <Text style={[styles.rowActivity, content.needsAttention && styles.attention]} numberOfLines={1}>
            {content.activity}
          </Text>
        </View>
        <Text style={[styles.rowPreview, stale && styles.stale]} numberOfLines={1}>
          {content.outcomeLabel ? `${content.outcomeLabel} · ` : ""}{content.outcome}
        </Text>
      </View>
      <View style={styles.hairline} />
    </PressScale>
    </View>
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
  const conversations = store.use((s) => s.conversations);
  const activeId = store.use((s) => s.activeId);
  const harnesses = store.use((s) => s.connection.harnesses);
  const connectionStatus = store.use((s) => s.connection.status);
  const hosts = store.use((s) => s.connection.hosts);
  const hasEnded = store.useSelector((s) => s.conversations.some(c => c.stale));
  const remote = usePagedChats({}, { focused, online: connectionStatus === "online" });

  // Entries keep their identity while a conversation's list placement and header are unchanged,
  // so most store changes (status, adoption, setActive) skip the merge entirely.
  const previousLocal = useRef<readonly ConversationEntry[]>(NO_ENTRIES);
  const local = useMemo(() => {
    previousLocal.current = stableEntries(previousLocal.current, conversationEntries(conversations));
    return previousLocal.current;
  }, [conversations]);
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
  const items = useMemo((): ChatListRow[] => {
    const rows = mergeLocal(labeled, { local, exhausted: remote.exhausted, endedLast: !remote.enabled, groupOf });
    return rows.length === 0 && remote.enabled && remote.status === "loading" ? SKELETONS : rows;
  }, [labeled, local, groupOf, remote.exhausted, remote.enabled, remote.status]);

  const liveKeys = useMemo(() => liveKeySet(hosts), [hosts]);
  const selfId = useMemo(() => hosts.find(host => host.self)?.id, [hosts]);
  const harnessNames = useMemo(() => new Map(harnesses.map(h => [h.id, h.name])), [harnesses]);

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
  const longPress = useMemo(() => rowLongPress(feedbackOn, onFeedback, remove), [feedbackOn, onFeedback, remove]);

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<ChatListRow>) => {
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

  const getItemType = useCallback((item: ChatListRow) => item.type, []);
  const keyExtractor = useCallback((item: ChatListRow) => item.key, []);
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
      {hasEnded && (
        <PressScale onPress={() => confirmDestructive("Clear ended chats?", "Saved history is removed from this phone only.", "Clear ended", clearEndedConversations)} accessibilityRole="button" style={[styles.clearEnded, thumb.align]}>
          <Text style={styles.clearEndedText}>Clear ended</Text>
        </PressScale>
      )}
      <FlashList
        data={items}
        renderItem={renderItem}
        getItemType={getItemType}
        keyExtractor={keyExtractor}
        extraData={`${activeId}:${connectionStatus}`}
        drawDistance={600}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No chats yet</Text>
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
  rowPreview: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  empty: { paddingTop: "40%", alignItems: "center" },
  emptyText: { color: colors.textMuted, ...type.body },
});
