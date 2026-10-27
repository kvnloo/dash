import { useEffect, useState } from "react";
import { Alert, AppState, Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createConversation, setActive, store } from "../store/app";
import { approvals, actionable } from "../store/approvals";
import { sharedDrafts, stageSharedDraft } from "../store/shared-drafts";
import { debugNavigationRef } from "../debug/nav";
import { consumeNativeShare, discardNativeShare } from "../lib/native-share";
import { isShareLink, type IncomingShare } from "../lib/incoming-share";
import { createReplyNoticeObserver } from "../lib/notification-policy";
import { startNativeNotifications, postNativeNotice, refreshNotificationPermission } from "../lib/native-notifications";
import { openNotificationTarget } from "../lib/notification-routing";
import { formatSize } from "../lib/attachments";
import { colors, space, type } from "../theme";

export function NativeEvents() {
  const [queue, setQueue] = useState<IncomingShare[]>([]);
  const insets = useSafeAreaInsets();
  const chats = store.use(s => s.conversations);
  const settings = store.use(s => s.settings);
  const staged = sharedDrafts.use(s => s);
  const share = queue[0];
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [share?.id]);
  useEffect(() => {
    let disposed = false;
    let stopNotifications = () => {};
    let consuming = Promise.resolve();
    const consume = () => {
      consuming = consuming.then(async () => {
        const incoming = await consumeNativeShare();
        if (!incoming) return;
        if (disposed) { await discardNativeShare(incoming.id); return; }
        setQueue(list => {
          if (list.some(s => s.id === incoming.id)) return list;
          if (list.length >= 3) { void discardNativeShare(incoming.id); Alert.alert("Share inbox full", "Review the waiting shares, then share this content again."); return list; }
          return [...list, incoming];
        });
      }).catch((error: unknown) => { if (!disposed) Alert.alert("Could not receive share", error instanceof Error ? error.message : "Share the content again from the source app."); });
    };
    void startNativeNotifications(openNotificationTarget).then(stop => { if (disposed) stop(); else stopNotifications = stop; });
    const observe = createReplyNoticeObserver(notice => { void postNativeNotice(notice); });
    observe(store.get().conversations);
    const unsubscribe = store.subscribe(() => observe(store.get().conversations));
    let gateIds = new Set(approvals.get().items.filter(actionable).map(i => i.id));
    let gateLoaded = approvals.get().loaded;
    const unsubscribeGate = approvals.subscribe(() => {
      const state = approvals.get();
      const next = new Set(state.items.filter(actionable).map(i => i.id));
      if (gateLoaded) for (const id of next) if (!gateIds.has(id)) void postNativeNotice({ key: `approval:${id}`, title: "Action needed", body: "Open Dash to review an approval.", target: { kind: "approvals" } });
      gateIds = next; gateLoaded = state.loaded;
    });
    const urls = Linking.addEventListener("url", ({ url }) => { if (isShareLink(url)) consume(); });
    const appState = AppState.addEventListener("change", state => { if (state === "active") { consume(); void refreshNotificationPermission(); } });
    consume();
    return () => { disposed = true; stopNotifications(); unsubscribe(); unsubscribeGate(); urls.remove(); appState.remove(); };
  }, []);
  const close = () => {
    if (share) void discardNativeShare(share.id);
    setQueue(list => list.slice(1));
  };
  const add = () => {
    if (!share || !settings || selected === null || (!share.text && !share.files.length) || !debugNavigationRef.isReady()) return;
    const chat = selected === "new" ? createConversation(settings.harness) : chats.find(c => c.id === selected && !c.stale);
    if (!chat) { Alert.alert("Chat unavailable", "Choose a current chat."); return; }
    if (!stageSharedDraft(chat.id, share)) { Alert.alert("Draft waiting", "Open this chat and review its existing shared draft first."); return; }
    setActive(chat.id);
    debugNavigationRef.navigate("Chat");
    setQueue(list => list.slice(1));
  };
  return <Modal visible={Boolean(share)} animationType="none" onRequestClose={close}>
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.md, paddingBottom: insets.bottom, paddingHorizontal: space.md }}>
      <Text style={{ ...type.body, color: colors.text, fontSize: 22 }}>Shared to Dash</Text>
      <ScrollView contentContainerStyle={{ gap: space.md, paddingVertical: space.md }}>
        <Text style={{ ...type.body, color: colors.textMuted }}>Review and choose a chat. Nothing is uploaded or sent. Files need a separate upload confirmation in the composer.</Text>
        {share?.text ? <Text selectable style={{ ...type.body, color: colors.text }}>{share.text}</Text> : null}
        {share?.files.map(file => <View key={file.uri}><Text style={{ ...type.body, color: colors.text }}>{file.name}</Text><Text style={{ ...type.mono, color: colors.textMuted }}>{file.mime} · {formatSize(file.size)}</Text></View>)}
        {share?.errors.map((error, index) => <Text accessibilityRole="alert" key={index} style={{ ...type.body, color: colors.danger }}>{error}</Text>)}
        {share && !share.text && !share.files.length ? <Text style={{ ...type.body, color: colors.danger }}>No readable content. Share again from the source app.</Text> : null}
        <Text style={{ ...type.body, color: colors.text }}>Destination chat</Text>
        {!settings ? <Text style={{ ...type.body, color: colors.textMuted }}>Pair Dash with your computer first, then share again.</Text> : [
          { id: "new", title: "New chat" }, ...chats.filter(c => !c.stale).slice(0, 50),
        ].map(chat => <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected === chat.id, disabled: Boolean(staged[chat.id]) }} disabled={Boolean(staged[chat.id])} key={chat.id} onPress={() => setSelected(chat.id)} style={{ minHeight: 48, justifyContent: "center", borderBottomWidth: 1, borderColor: colors.border }}><Text style={{ ...type.body, color: selected === chat.id ? colors.gold : colors.textMuted }}>{selected === chat.id ? "● " : "○ "}{chat.title}{staged[chat.id] ? " · shared draft waiting" : ""}</Text></Pressable>)}
      </ScrollView>
      <Pressable accessibilityRole="button" disabled={!selected || !settings || (!share?.text && !share?.files.length)} onPress={add} style={{ minHeight: 48, justifyContent: "center", opacity: selected && settings && (share?.text || share?.files.length) ? 1 : 0.4 }}><Text style={{ ...type.body, color: colors.gold }}>Add to draft</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={close} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ ...type.body, color: colors.textMuted }}>Cancel and discard</Text></Pressable>
    </View>
  </Modal>;
}
