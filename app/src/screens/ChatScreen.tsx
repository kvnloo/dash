import { useContextView } from "../components/ContextCard";
import { DETAIL_MODES } from "../lib/reply-details";
import { useHandedness } from "../lib/useHandedness";
import { BlurTargetView } from "expo-blur";
import { Canvas } from "../components/Canvas";
import { setThinkingSummaries } from "../store/app";
import { ScreenHeader } from "../components/ScreenHeader";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Platform, StyleSheet, Text, View, Pressable, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { ComposerActionMenu, type ComposerMenuRow } from "../components/ComposerActionMenu";
import { OrbActivity } from "../components/OrbMotion";
import { WindowDock, WindowPill, useDisplayCutout, useWindowMorph } from "../components/ChatWindow";
import { backTarget, hostIdentity, pillGeometry, pillPrimary, pillReserve, pillStatus, surfaceValue, type IdentityInput } from "../lib/chat-window";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Composer } from "../components/Composer";
import { composerPlaceholder } from "./composer-placeholder";
import { sessionViewerLabel } from "./session-viewer-label";
import { KeyboardDock, KeyboardInsetView } from "../components/KeyboardDock";
import { ConnectionPill } from "../components/ConnectionPill";
import { HarnessPicker } from "../components/HarnessPicker";
import { AppNav } from "../components/AppNav";
import { MessageRow } from "../components/MessageRow";
import { SkeletonRow } from "../components/SkeletonRow";
import { useHistoryPages } from "../hooks/useHistoryPages";
import { fetchFullText, listUnlisted } from "../store/history-pages";
import { LiveSurface } from "../components/LiveSurface";
import { PressScale } from "../components/PressScale";
import { isDebugActive } from "../debug/expose";
import { debugUi } from "../debug/ui-store";
import { haptic } from "../haptics";
import { canSteer, type SendMode } from "../lib/composer-mode";
import type { ChatAttachment } from "../../../shared/protocol";
import type { Message } from "../model";
import type { ScreenProps } from "../navigation";
import { bridge, openLiveSurface, permissionRequests, sendChat, sendLiveTurn } from "../net/bridge";
import { PermissionCard } from "../components/PermissionCard";
import { EMPTY_LIVE, liveOf, liveStore, setLiveOpen } from "../store/live";
import {
  applyTurnEvent,
  beginTurn,
  conversationBusy,
  conversationTargetError,
  createConversation,
  parkUnsentTurn,
  flushPendingSends,
  releaseViewOnly,
  replaceMessageText,
  takeQueuedForSteer,
  changeQueuePreview,
  saveQueuePreview,
  setQueueWaiting,
  saveSettings,
  setActive,
  setDetailMode,
  stopConversation,
  store,
} from "../store/app";
import { onTurnSettled } from "../store/queue";
import { queuedParts } from "../lib/pending-queue";
import { QueuedStack } from "../components/QueuedStack";
import { colors, glass, radius, space, type } from "../theme";
import { useLiveThinking } from "../lib/live-thinking";
import type { OrbState } from "../lib/orb-phase";
import { useContinuousVoice, useDeviceInsets, voiceWindowOpen } from "../components/ContinuousVoiceRoot";
import { sendVoiceAnnotation } from "../lib/voice-annotation";
import { useSessionActivity } from "../lib/session-activity";
import { screenBack } from "../lib/screen-back";
import { AgentOrb } from "../components/AgentOrb";
import { useSessionWorkers, WorkersStrip } from "../components/WorkersStrip";
import { approvals, actionable } from "../store/approvals";
import { PromptRail } from "../components/PromptRail";
import { followsLatest, promptOffset } from "../lib/prompt-navigation";
import { railTurns, type RailTurn } from "../lib/rail-turns";
import { enterAnnotation, registerSink } from "../store/annotate";
import { sharedDrafts, consumeSharedDraft } from "../store/shared-drafts";

const EMPTY: Message[] = [];

function keyExtractor(item: Message): string {
  return item.id;
}

function getItemType(item: Message): string {
  return item.role;
}

export function ChatScreen({ navigation, route }: ScreenProps<"Chat">) {
  const thumb = useHandedness();
  const composerDraft = route.params?.draft;
  const insets = useSafeAreaInsets();
  // The window owns the full screen: its pill hugs the real status band (device insets), not the voice bar band.
  const deviceTop = useDeviceInsets().top;
  const blurTarget = useRef<View>(null);
  const listRef = useRef<FlashListRef<Message>>(null);
  const followRef = useRef(true);
  const dragging = useRef(false);
  const previousOffset = useRef(0);
  const [following, setFollowing] = useState(true);
  const setFollow = useCallback((next: boolean) => { followRef.current = next; setFollowing(next); }, []);
  const scrollToNewest = useCallback(() => {
    if (followRef.current) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, []);
  const debugPicker = debugUi.use((s) => s.chatHarnessPickerOpen);
  const debugAttachments = debugUi.use((s) => s.chatComposerAttachments);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerVisible = debugPicker ?? pickerOpen;
  const setPickerVisible = useCallback((open: boolean) => {
    setPickerOpen(open);
    if (isDebugActive()) debugUi.set((s) => ({ ...s, chatHarnessPickerOpen: open }));
  }, []);

  const approvalCount = approvals.use(s => s.items.filter(actionable).length);
  const approvalDryRun = approvals.use(s => s.dryRun);
  const settings = store.use((s) => s.settings);
  const connection = store.use((s) => s.connection);
  const conversation = store.use((s) => s.conversations.find((c) => c.id === s.activeId));
  const sharedDraft = sharedDrafts.use(s => conversation ? s[conversation.id] : undefined);
  const messages = conversation?.messages ?? EMPTY;
  // Older pages (scrolled up) live in memory beside the conversation's own newest window.
  const history = useHistoryPages(conversation);
  const older = history.older;
  const visibleMessages = useMemo(() => {
    const queued = new Set(conversation ? queuedParts(conversation).flatMap(part => [part.user.id, part.assistant.id]) : []);
    const current = messages.filter(message => !queued.has(message.id));
    if (!older.length) return current;
    const shown = new Set(current.map(message => message.id));
    return [...older.filter(message => !shown.has(message.id)), ...current];
  }, [messages, conversation, older]);
  // A view-only chat is transient: closing it drops it from the phone.
  const viewOnlyId = conversation?.viewOnly ? conversation.id : undefined;
  useEffect(() => () => { if (viewOnlyId) releaseViewOnly(viewOnlyId); }, [viewOnlyId]);
  const showFull = useCallback((messageId: string) => {
    if (!conversation) return;
    const target = conversation;
    void fetchFullText(target, messageId).then(text => { if (text !== undefined) replaceMessageText(target.id, messageId, text); });
  }, [conversation]);
  // The prompt rail stands for the whole chat: its prompts come from the rows the list shows and from the
  // older rows paged in behind them for the rail alone (`unlisted`). Those are not list rows (rows added above
  // a reader who has scrolled up move what they are reading); they join the list when the reader scrolls to
  // the top, or when they jump to one of their prompts.
  const railOnly = useMemo(() => {
    if (!history.unlisted.length) return history.unlisted;
    // The chat's own window can grow over rows that were paged in meanwhile: a row is on the rail once.
    const listed = new Set(visibleMessages.map(message => message.id));
    return history.unlisted.filter(message => !listed.has(message.id));
  }, [history.unlisted, visibleMessages]);
  const railMessages = useMemo(() => railOnly.length ? [...railOnly, ...visibleMessages] : visibleMessages, [railOnly, visibleMessages]);
  const anchors = useMemo(() => railTurns(railMessages), [railMessages]);
  useEffect(() => { setFollow(true); }, [conversation?.id, setFollow]);
  const jumpedTo = useRef<string | null>(null);
  const scrollToPrompt = useCallback((anchor: RailTurn, railOnlyRows: number) => {
    // `anchor.index` counts the rail's rows; the list's own rows start after the rail-only ones.
    const at = { ...anchor, index: anchor.index - railOnlyRows };
    const offset = promptOffset([at], 0, index => listRef.current?.getLayout(index));
    if (offset !== null) listRef.current?.scrollToOffset({ offset, animated: false });
    else void listRef.current?.scrollToIndex({ index: at.index, animated: false, viewPosition: 0 });
  }, []);
  const jumpPrompt = useCallback((prompt: number) => {
    const anchor = anchors[prompt];
    if (!anchor || !conversation) return;
    dragging.current = false;
    setFollow(false);
    if (anchor.index >= railOnly.length) { scrollToPrompt(anchor, railOnly.length); return; }
    // The prompt is above what the list holds: list it (and everything between), then scroll to it.
    jumpedTo.current = anchor.id;
    listUnlisted(conversation.id, anchor.id);
  }, [anchors, conversation, railOnly.length, scrollToPrompt, setFollow]);
  useEffect(() => {
    const id = jumpedTo.current;
    if (!id) return;
    const anchor = anchors.find(a => a.id === id);
    if (!anchor) { jumpedTo.current = null; return; }
    if (anchor.index < railOnly.length) return;
    // The rows just listed are laid out on the next frame.
    const timer = setTimeout(() => {
      if (jumpedTo.current !== id) return;
      jumpedTo.current = null;
      scrollToPrompt(anchor, railOnly.length);
    }, 50);
    return () => clearTimeout(timer);
  }, [anchors, railOnly.length, scrollToPrompt]);
  const harnessId = conversation?.harness ?? settings?.harness ?? "omp";
  const harness = connection.harnesses.find((h) => h.id === harnessId);
  const harnessName = harness?.name ?? harnessId;
  const online = connection.status === "online";
  const targetError = conversation ? conversationTargetError(conversation) : undefined;
  const live = liveStore.use((all) => (conversation ? all[conversation.id] ?? EMPTY_LIVE : EMPTY_LIVE));
  const liveOn = harnessId === "hermes" && live.open;
  useEffect(() => { if (sharedDraft && conversation) setLiveOpen(conversation.id, false); }, [sharedDraft, conversation?.id]);

  const toggleLive = useCallback(() => {
    const active = conversation ?? createConversation("hermes");
    const next = !liveOf(active.id).open;
    haptic.select();
    setLiveOpen(active.id, next);
    if (next && liveOf(active.id).status !== "ready") openLiveSurface(active.id, { profileId: active.profileId, sessionId: active.sessionId });
  }, [conversation]);

  const onLiveSend = useCallback((text: string) => {
    if (conversation) { haptic.tap(); sendLiveTurn(conversation.id, text); }
  }, [conversation]);

  const { thinking, caption, external, observed, streamingMessage } = useLiveThinking(conversation);
  useSessionActivity(settings, online && harnessId === "hermes" && !streamingMessage, conversation?.profileId, conversation?.sessionId, conversation?.targetHostId);
  const workers = useSessionWorkers(settings, online && harnessId === "hermes", conversation?.profileId, conversation?.sessionId);
  const [chatOptions, setChatOptions] = useState(false);
  const context = useContextView(settings, online && (!conversation?.targetHostId || connection.hosts.some(host => host.self && host.id === conversation.targetHostId)), harnessId, conversation?.profileId, conversation?.sessionId, thinking.phase !== "idle");
  const latestAssistant = [...messages].reverse().find(message => message.role === "assistant");
  const permissionRecords = permissionRequests.state.use(s => s.records);
  // Open requests, plus the settled ones of the latest turn so the owner sees the host's outcome.
  const permissionCards = conversation ? Object.values(permissionRecords).filter(record => record.conversationId === conversation.id &&
    (record.phase === "pending" || record.phase === "deciding" || record.turnId === latestAssistant?.turnId)) : [];
  const voice = useContinuousVoice();
  const voiceActive = !["idle", "error"].includes(voice.state.phase);
  // Broker liveness/another client's call is not evidence that Dash's mic is live.
  const voiceCall: OrbState | undefined = voiceActive ? { phase: voice.state.phase === "hearing" ? "listening" : voice.state.phase === "error" ? "idle" : voice.state.phase } : undefined;
  const onVoice = () => {
    // A live call already shows its one Mute/End home (window dock row, else the app-wide bar).
    if (voiceActive) return;
    void voice.start();
  };

  const sendTurn = useCallback(
    (text: string, attachments: ChatAttachment[], active = conversation ?? createConversation(harnessId), mode: SendMode = "queue") => {
      const { turnId } = beginTurn(active.id, text, { attachments, mode });
      haptic.tap();
      const current = store.get().conversations.find((c) => c.id === active.id) ?? active;
      const ok = sendChat({
        turnId,
        harness: current.harness,
        mode,
        text,
        sessionId: current.sessionId,
        cwd: current.cwd,
        attachments,
      });
      if (!ok) {
        if (mode === "steer") applyTurnEvent({ type: "error", id: turnId, seq: 1, message: "Offline: steer was not sent. It will not be retried automatically." });
        else parkUnsentTurn(turnId);
      }
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    },
    [conversation, harnessId],
  );

  const flushQueue = useCallback(
    (_conversationId: string) => { if (online) flushPendingSends(sendChat); },
    [online],
  );

  const onSend = useCallback(
    (text: string, attachments: ChatAttachment[], mode: SendMode = "queue") => {
      dragging.current = false;
      setFollow(true);
      const active = conversation ?? createConversation(harnessId);
      if (mode === "steer") { sendTurn(text, attachments, active, "steer"); return; }
      if (conversationBusy(active.id) || thinking.phase !== "idle") {
        if (!streamingMessage && thinking.phase !== "idle") setQueueWaiting(active.id, true);
        beginTurn(active.id, text, { pending: true, attachments });
        haptic.tap();
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        return;
      }
      sendTurn(text, attachments, active);
    },
    [conversation, harnessId, sendTurn, setFollow, thinking.phase, streamingMessage],
  );

  // Annotation mode sends into this chat: steer a running Hermes turn, else send/queue.
  const steerableRef = useRef(false);
  steerableRef.current = canSteer(harnessId, conversation?.sessionId, thinking.phase, liveOn);
  useEffect(() => {
    if (!conversation) return;
    return registerSink({ label: `${harnessName} chat`, steerable: () => steerableRef.current, send: (text, attachments, mode) => {
      if (liveOn) setLiveOpen(conversation.id, false);
      return sendVoiceAnnotation(conversation, text, attachments, () => {}, mode);
    } });
  }, [conversation, harnessName, liveOn]);

  useEffect(() => {
    if (!conversation) return;
    return onTurnSettled((id) => {
      if (id === conversation.id) flushQueue(id);
    });
  }, [conversation?.id, flushQueue]);

  useEffect(() => {
    if (conversation && !streamingMessage && queuedParts(conversation).length > 0) flushQueue(conversation.id);
  }, [conversation?.id, streamingMessage, flushQueue]);

  useEffect(() => {
    if (online && conversation && queuedParts(conversation).length > 0) flushQueue(conversation.id);
  }, [online, conversation?.id, flushQueue]);

  useEffect(() => {
    if (conversation?.queueWaitForIdle && observed?.observed && observed.phase === "idle") {
      setQueueWaiting(conversation.id, false);
      flushQueue(conversation.id);
    }
  }, [conversation?.id, conversation?.queueWaitForIdle, observed?.observed, observed?.phase, flushQueue]);

  const onStop = useCallback(() => {
    if (conversation) stopConversation(conversation.id, (id) => { bridge.send({ type: "cancel", id }); });
  }, [conversation]);

  const onSelectHarness = useCallback(
    (id: string) => {
      if (!settings) return;
      haptic.select();
      saveSettings({ ...settings, harness: id });
      // Sessions are harness-specific, so switching mid-conversation starts a fresh chat.
      if (conversation && conversation.harness !== id) {
        setActive(null);
        // The route draft seeded the chat it was opened for. Without this the fresh composer
        // re-seeds from it, so a draft the owner already cleared came back (e2e B4).
        if (route.params?.draft !== undefined) navigation.setParams({ draft: undefined });
      }
    },
    [settings, conversation, navigation, route.params?.draft],
  );

  // Window presentation: opened from the Chats list over the retained workspace.
  const windowOrigin = route.params?.window;
  const windowed = windowOrigin !== undefined;
  const morph = useWindowMorph(windowOrigin, windowed);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [navOpen, setNavOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Native DisplayCutout rect when the APK provides it; null (web, Expo Go, older APK, no cut-out) keeps the safe-area pill.
  const cutout = useDisplayCutout(windowWidth, windowHeight, deviceTop);
  const pill = useMemo(() => pillGeometry({ insetTop: deviceTop, width: windowWidth, cutout }), [deviceTop, windowWidth, cutout]);
  // While this window is open its dock row is the single voice Mute/End home; the app-wide bar steps aside
  // (the root call is untouched: no stop, no remount).
  useEffect(() => {
    if (!windowed) return;
    voiceWindowOpen.set(true);
    return () => voiceWindowOpen.set(false);
  }, [windowed]);
  const closeWindow = useCallback(() => {
    // Presentation only: no cancel, stop, voice end or conversation change happens here.
    morph.close(() => screenBack(navigation));
  }, [morph, navigation]);
  const layers = useRef({ menuOpen, treeOpen, navOpen });
  layers.current = { menuOpen, treeOpen, navOpen };
  useEffect(() => {
    if (!windowed) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      switch (backTarget(layers.current)) {
        case "menu": setMenuOpen(false); break;
        case "tree": setTreeOpen(false); break;
        case "nav": setNavOpen(false); break;
        case "window": closeWindow(); break;
      }
      return true;
    });
    return () => sub.remove();
  }, [windowed, closeWindow]);
  const selfHost = connection.hosts.find(host => host.self);
  // Authoritative per-session model/provider/lineage: the host's existing authenticated context
  // reading (Hermes state.db), bound to this exact session. Debug fixture is synthetic, web-only.
  const hostFixture = debugUi.use(s => s.hostSessionFixture ?? null);
  const hostReading = hostFixture ?? context.snapshot;
  const [observedAt, setObservedAt] = useState<number>();
  useEffect(() => { setObservedAt(hostReading ? Date.now() : undefined); }, [hostReading]);
  const identity = useMemo((): IdentityInput => ({
    // A chat-index host (`machine:<name>`) that the roster does not list: show the machine name.
    hostName: conversation?.targetHostId ? connection.hosts.find(host => host.id === conversation.targetHostId)?.name ?? conversation.targetHostId.replace(/^machine:/, "") : selfHost?.name ?? (connection.host || undefined),
    harnessName,
    profile: conversation?.profileName ?? conversation?.profileId,
    sessionId: conversation?.sessionId,
    // Never a default name: unknown unless the host reported it for this exact session.
    ...hostIdentity(hostReading ?? undefined, conversation?.sessionId, observedAt),
  }), [conversation?.targetHostId, conversation?.profileName, conversation?.profileId, conversation?.sessionId, connection.hosts, connection.host, selfHost?.name, harnessName, hostReading, observedAt]);
  const queuedCount = conversation ? queuedParts(conversation).length : 0;
  const detailMode = conversation?.detailMode ?? "Compact";
  const menuRows = useMemo((): ComposerMenuRow[] => {
    const rows: ComposerMenuRow[] = [];
    if (harnessId === "hermes" && conversation) rows.push({
      id: "surface", label: "Surface", value: surfaceValue(liveOn), values: ["Chat", "Live surface"], index: liveOn ? 1 : 0,
      run: toggleLive, inspect: index => { if ((index === 1) !== liveOn) toggleLive(); },
    });
    rows.push({
      id: "details", label: "Thinking & tools", value: detailMode, values: [...DETAIL_MODES], index: Math.max(0, DETAIL_MODES.indexOf(detailMode)),
      run: () => { const active = conversation ?? createConversation(harnessId); setDetailMode(active.id, DETAIL_MODES[(DETAIL_MODES.indexOf(detailMode) + 1) % DETAIL_MODES.length] ?? "Compact"); },
      inspect: index => { const mode = DETAIL_MODES[index]; if (mode) setDetailMode((conversation ?? createConversation(harnessId)).id, mode); },
    });
    if (conversation) rows.push({ id: "summaries", label: "Thinking summaries", value: conversation.summariesEnabled ? "On · next turn" : "Off", run: () => setThinkingSummaries(conversation.id, !conversation.summariesEnabled) });
    rows.push({ id: "annotate", label: "Annotate", value: "S Pen or finger", run: () => enterAnnotation() });
    if (approvalCount > 0) rows.push({ id: "approvals", label: "Approvals", value: `${approvalCount} pending${approvalDryRun ? " · preview" : ""} ›`, run: () => navigation.navigate("Approvals") });
    rows.push({ id: "harness", label: "Harness", value: `${harnessName} · Change…`, run: () => setPickerVisible(true) });
    return rows;
  }, [harnessId, conversation, liveOn, toggleLive, detailMode, approvalCount, approvalDryRun, navigation, harnessName, setPickerVisible]);

  const dockBody = <>
    <WorkersStrip workers={workers} />
    {voice.state.phase === "error" ? <View style={styles.liveRow}>
      <Text accessibilityRole="alert" style={[styles.liveNote, { flex: 1 }]}>{voice.state.note}</Text>
      <PressScale accessibilityRole="button" accessibilityLabel="Retry Live voice" onPress={() => void voice.start()} style={styles.liveChip}><Text style={styles.liveChipText}>Retry voice</Text></PressScale>
    </View> : null}
    {windowed && voiceActive ? <View testID="window-voice-controls" style={[styles.liveRow, thumb.row]}>
      <PressScale testID="voice-mute" accessibilityRole="button" accessibilityLabel={voice.state.muted ? "Unmute voice microphone" : "Mute voice microphone"} onPress={voice.mute} style={styles.liveChip}><Text style={styles.liveChipText}>{voice.state.muted ? "Unmute" : "Mute"}</Text></PressScale>
      <PressScale testID="voice-end" accessibilityRole="button" accessibilityLabel="End voice call" onPress={() => void voice.stop()} style={styles.liveChip}><Text style={styles.liveChipText}>{voice.state.phase === "connecting" ? "Cancel connection" : "End voice"}</Text></PressScale>
    </View> : null}
    {windowed ? null : <View style={styles.liveRow}>
      <PressScale accessibilityRole="button" accessibilityLabel="Choose harness" onPress={() => { haptic.select(); setPickerVisible(true); }} style={styles.liveChip}><Text style={styles.liveChipText}>{harnessName} · Change</Text></PressScale>
      {approvalCount > 0 ? <PressScale accessibilityRole="button" accessibilityLabel={`Review ${approvalCount} approvals${approvalDryRun ? ", preview only" : ""}`} onPress={() => { haptic.select(); navigation.navigate("Approvals"); }} style={styles.approval}><Text style={styles.approvalText}>{approvalCount} approvals{approvalDryRun ? " · preview" : ""} ›</Text></PressScale> : null}
    </View>}
    {chatOptions && !windowed ? <>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 16, gap: 4 }}>
      {/* Temporary entry point until the page-aware composer filter menu lands (sol-density-dial). */}
      <PressScale accessibilityRole="button" accessibilityLabel="Annotate this screen" onPress={() => { haptic.select(); enterAnnotation(); }} style={{ minHeight: 32, paddingHorizontal: 8, justifyContent: "center", marginRight: "auto" }}><Text style={{ ...type.mono, fontSize: 11, color: colors.gold }}>✎ Annotate</Text></PressScale>
      <Text style={{ ...type.mono, color: colors.textTertiary, fontSize: 10, marginRight: 6 }}>Thinking & tools</Text>
      {DETAIL_MODES.map(mode => <PressScale key={mode} accessibilityRole="button" accessibilityLabel={`Details ${mode}`} accessibilityState={{ selected: (conversation?.detailMode ?? "Compact") === mode }} onPress={() => { const active = conversation ?? createConversation(harnessId); setDetailMode(active.id, mode); }} style={{ minHeight: 32, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ ...type.mono, fontSize: 11, color: (conversation?.detailMode ?? "Compact") === mode ? colors.gold : colors.textTertiary }}>{mode}</Text></PressScale>)}
    </View>
    </> : null}
    {permissionCards.map(record => <PermissionCard key={record.turnId + "/" + record.requestId} requestId={record.requestId} turnId={record.turnId}
      options={record.options} deadlineAt={record.deadlineAt} phase={record.phase} onChoose={optionId => permissionRequests.decide(record, optionId)} />)}
    {conversation && !liveOn ? <QueuedStack conversation={conversation} canSteer={online && !targetError && canSteer(harnessId, conversation.sessionId, thinking.phase, liveOn)} onSteer={() => { const payload = takeQueuedForSteer(conversation.id); if (payload) sendTurn(payload.text, payload.attachments, conversation, "steer"); }} /> : null}
    <Composer
      draftKey={conversation?.id}
      context={context}
      key={`${conversation?.id ?? harnessId}:${composerDraft ?? (debugAttachments ? "debug-attachments" : "composer")}`}
      initialAttachments={isDebugActive() ? debugAttachments ?? undefined : undefined}
      sharedDraft={sharedDraft}
      onSharedDraftConsumed={id => { if (conversation) consumeSharedDraft(conversation.id, id); }}
      disabled={!online || targetError !== undefined || (liveOn && live.status !== "ready")}
      streaming={liveOn ? live.busy : conversation ? conversationBusy(conversation.id) : false}
      steerBusy={canSteer(harnessId, conversation?.sessionId, thinking.phase, liveOn)}
      initialText={composerDraft}
      queuePreview={conversation?.queuePreview}
      onQueuePreviewChange={text => { if (conversation) changeQueuePreview(conversation.id, text); }}
      onSaveQueuePreview={() => { if (conversation) saveQueuePreview(conversation.id); }}
      harness={harnessId}
      blurTarget={liveOn ? undefined : blurTarget}
      cwd={conversation?.cwd}
      placeholder={liveOn ? (live.askHermes ? "Ask Hermes through the live surface" : "Live surface · quick reply") : composerPlaceholder({
        online,
        streaming: Boolean(streamingMessage),
        queued: queuedCount,
        openIn: conversation?.openIn,
        harness: harnessId,
        harnessName,
      })}
      onSend={(text, attachments, mode) => {
        if (liveOn && !attachments.length) onLiveSend(text);
        else {
          if (liveOn && conversation) setLiveOpen(conversation.id, false);
          onSend(text, attachments, mode);
        }
      }}
      onStop={onStop}
      onVoice={onVoice}
      voiceCall={voiceCall}
    />
  </>;

  const optionsTrigger = <ComposerActionMenu
    testID="chat-window-options"
    label={`Options. Current surface: ${liveOn ? "Live surface" : "Chat"}`}
    rows={menuRows}
    open={menuOpen}
    onOpenChange={setMenuOpen}
  >
    <View style={styles.optionsTrigger}>
      <Feather name="sliders" size={15} color={colors.textMuted} />
      <Text style={styles.optionsTriggerText}>{liveOn ? "Live" : "Chat"}</Text>
      {approvalCount > 0 ? <View accessibilityLabel={`${approvalCount} approvals pending`} style={styles.approvalDot} /> : null}
    </View>
  </ComposerActionMenu>;

  // Ambient orb loops force a Fabric commit of the whole transcript every frame (UI thread 100%, p50 36 ms).
  // Keep them still in the chat; ShimmerText (Skia) still shows live activity.
  return (
    <OrbActivity active={false}>
    <Animated.View style={[styles.screen, { paddingTop: windowed ? pillReserve(pill, deviceTop) : insets.top }, morph.style]} renderToHardwareTextureAndroid={morph.settling} testID={windowed ? "chat-window" : undefined}><Canvas />
      {windowed ? <>
        <WindowPill geometry={pill} title={conversation?.title || harnessName} thinking={thinking}
          status={pillStatus({ online, phase: thinking.phase, tool: thinking.tool, voicePhase: voiceCall?.phase, queued: queuedCount })}
          primary={pillPrimary({ online, phase: thinking.phase, tool: thinking.tool, voicePhase: voiceCall?.phase, queued: queuedCount })}
          open={navOpen} onToggle={() => setNavOpen(value => !value)} />
        {navOpen ? <AppNav navigation={navigation} tab={1} /> : null}
      </> : <>
      <AppNav navigation={navigation} tab={1} />
      <ScreenHeader compact title={conversation?.title || harnessName} onBack={() => screenBack(navigation)} />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: chatOptions }} accessibilityLabel="Chat options" onPress={() => setChatOptions(v => !v)} style={styles.optionsToggle}><Text style={styles.optionsToggleText}>{chatOptions ? "Hide options" : "Options"}</Text></Pressable>
      </>}
      <ConnectionPill />
      {chatOptions && !windowed ? <View>
      {conversation ? <PressScale accessibilityRole="switch" accessibilityLabel="Thinking summaries" accessibilityState={{ checked: conversation.summariesEnabled === true }} onPress={() => setThinkingSummaries(conversation.id, !conversation.summariesEnabled)} style={styles.liveRow}><Text style={styles.liveNote}>Thinking summaries · {conversation.summariesEnabled ? "on" : "off"} · next turn</Text></PressScale> : null}
      {targetError ? <Text accessibilityRole="alert" style={styles.targetError}>{targetError}</Text> : null}
      {!targetError && conversation?.openIn ? (
        <Text accessibilityRole="text" style={styles.handoffNote}>
          {sessionViewerLabel(conversation.openIn, conversation.targetHostId, connection)}
        </Text>
      ) : null}
      {harnessId === "hermes" ? (
        <View style={styles.liveRow}>
          <PressScale accessibilityRole="switch" accessibilityLabel="Live surface" accessibilityState={{ checked: liveOn }} aria-checked={liveOn}
            onPress={toggleLive} style={[styles.liveChip, liveOn && styles.liveChipOn]}>
            <Text style={[styles.liveChipText, liveOn && styles.liveChipTextOn]}>Live surface</Text>
          </PressScale>
          <Text style={styles.liveNote} numberOfLines={1}>{liveOn ? "fast lane · Hermes stays in charge" : "Hermes chat"}</Text>
        </View>
      ) : null}
      </View> : null}
      {liveOn && conversation ? <KeyboardInsetView style={styles.body}><LiveSurface conversationId={conversation.id} /></KeyboardInsetView> : <KeyboardInsetView style={styles.body} onOpen={scrollToNewest}>
        {/* Absolute overlays must use the unpadded list viewport, not the IME inset box. */}
        <View style={styles.viewport} testID="transcript-viewport">
        <BlurTargetView ref={blurTarget} style={styles.body}><FlashList
          ref={listRef}
          data={visibleMessages}
          extraData={external}
          renderItem={({ item }) => item.truncated ? <View>
            <MessageRow message={item} detailMode={conversation?.detailMode ?? "Compact"} harnessId={harnessId} thinking={item.id === latestAssistant?.id ? external : undefined} />
            <PressScale accessibilityRole="button" accessibilityLabel="Show full message" onPress={() => showFull(item.id)} style={styles.showFull}><Text style={styles.showFullText}>Show full message</Text></PressScale>
          </View> : <MessageRow message={item} detailMode={conversation?.detailMode ?? "Compact"} harnessId={harnessId} thinking={item.id === latestAssistant?.id ? external : undefined} />}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
          onStartReached={history.canLoadOlder ? history.loadOlder : undefined}
          onStartReachedThreshold={0.5}
          ListHeaderComponent={history.loading ? <SkeletonRow /> : null}
          onScrollBeginDrag={() => { dragging.current = true; }}
          onScroll={event => {
            const { contentSize, layoutMeasurement, contentOffset } = event.nativeEvent;
            const moved = Math.abs(contentOffset.y - previousOffset.current) > 1;
            previousOffset.current = contentOffset.y;
            // Web wheel scrolling has no onScrollBeginDrag. A content resize alone
            // must not detach following before onContentSizeChange can scroll.
            if (!moved || (!dragging.current && Platform.OS !== "web")) return;
            setFollow(followsLatest(contentSize.height, layoutMeasurement.height, contentOffset.y));
          }}
          scrollEventThrottle={16}
          onContentSizeChange={scrollToNewest}
          contentContainerStyle={[styles.listContent, thumb.railPadding(44)]}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <AgentOrb size={64} thinking={thinking} label={`${harnessName} ${caption}`} />
              <Text style={styles.emptyTitle}>{harnessName}</Text>
              <Text style={styles.emptySubtitle}>
                {online && (identity.hostName || connection.host) ? `on ${identity.hostName || connection.host}` : "Ask anything"}
              </Text>
            </View>
          }
        /></BlurTargetView>
        <PromptRail anchors={anchors} following={following} live={Boolean(streamingMessage)} onJump={jumpPrompt}
          onContinue={prompt => { const anchor = anchors[prompt]; if (anchor) navigation.setParams({ draft: `Continue from prompt ${prompt + 1}: ${anchor.text.split("\n")[0]}\nResult: ${anchor.summary}\n\n` }); }}
          onLatest={() => { dragging.current = false; setFollow(true); scrollToNewest(); }} />
        </View>
      </KeyboardInsetView>}
      <KeyboardDock style={windowed ? styles.windowDock : undefined}>
        {windowed ? <WindowDock
          identity={identity}
          title={conversation?.title || harnessName}
          options={optionsTrigger}
          treeOpen={treeOpen}
          onTree={setTreeOpen}
          onClose={closeWindow}
          notice={targetError ? <Text accessibilityRole="alert" style={styles.targetError}>{targetError}</Text>
            : conversation?.openIn ? <Text accessibilityRole="text" style={styles.handoffNote}>{sessionViewerLabel(conversation.openIn, conversation.targetHostId, connection)}</Text> : null}
        >{dockBody}</WindowDock> : dockBody}
      </KeyboardDock>
      <HarnessPicker
        visible={pickerVisible}
        harnesses={connection.harnesses}
        selected={harnessId}
        onSelect={onSelectHarness}
        onClose={() => setPickerVisible(false)}
      />
    </Animated.View>
    </OrbActivity>
  );
}

const styles = StyleSheet.create({
  windowDock: {
    backgroundColor: glass.fillRaised, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, borderColor: glass.hair2, paddingTop: space.xs,
  },
  optionsTrigger: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  optionsTriggerText: { ...type.label, color: colors.textMuted, letterSpacing: 0 },
  approvalDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warn },
  optionsToggle: { alignSelf: "flex-start", marginLeft: 20, marginTop: -2, marginBottom: 4, paddingVertical: 4 },
  optionsToggleText: { ...type.mono, fontSize: 10, color: colors.textFaint },
  screen: { flex: 1, backgroundColor: colors.bg },
  approval: { minHeight: 44, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.lg, borderBottomWidth: 1, borderColor: colors.hair },
  approvalText: { ...type.small, color: colors.warn },
  targetError: { color: colors.danger, ...type.small, paddingHorizontal: space.lg, paddingVertical: space.sm },
  handoffNote: { color: colors.textTertiary, ...type.small, paddingHorizontal: space.lg, paddingVertical: space.sm },
  body: { flex: 1 },
  viewport: { flex: 1, minHeight: 0 },
  listContent: { paddingVertical: space.sm },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: "45%" },
  emptyTitle: { color: colors.text, ...type.title },
  emptySubtitle: { color: colors.textMuted, ...type.body, marginTop: 6 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.xs },
  liveChip: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: glass.hair, backgroundColor: glass.fillChip, paddingHorizontal: space.md, justifyContent: "center" },
  liveChipOn: { borderColor: colors.gold, backgroundColor: glass.fillChipOn },
  liveChipText: { ...type.label, color: colors.textMuted },
  liveChipTextOn: { color: colors.gold },
  liveNote: { ...type.mono, color: colors.textTertiary, flex: 1 },
  showFull: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: space.lg },
  showFullText: { ...type.label, color: colors.gold },
});
