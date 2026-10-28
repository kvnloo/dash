import { sessionChats } from "../../lib/session-chats";
import { shallowArrayEqual } from "../../store/createStore";
import { memo, useCallback, useMemo, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { HostStatsRow } from "../../components/HostStatsRow";
import { colors, space, type } from "../../theme";
import type { AgentInfo, BotInfo, HostInfo } from "../../../../shared/protocol";
import { Tree } from "../../components/Tree";
import { botsTree, hostLabel } from "../../lib/bots-tree";
import { botSummary } from "../../lib/bots";
import { profileFromAgent } from "../../lib/roster";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import type { ScreenProps } from "../../navigation";
import { openAgentConversation, store } from "../../store/app";

export const BotsPane = memo(function BotsPane({ navigation, focused = true }: Pick<ScreenProps<"Main">, "navigation"> & { focused?: boolean }) {
  const [selectedHost, setSelectedHost] = useState<HostInfo | null>(null);
  const hosts = store.use(s => s.connection.hosts);
  // Only host sessions matter here; a phone-only chat changing must not re-render this pane.
  const conversations = store.useSelector(sessionChats, shallowArrayEqual);
  const open = useCallback((host: HostInfo, agent: AgentInfo) => {
    const result = openAgentConversation(profileFromAgent(host, agent));
    if ("error" in result) { Alert.alert("Session unavailable", result.error); return; }
    navigation.navigate("Chat");
  }, [navigation]);
  const actions = useCallback((host: HostInfo, bot?: BotInfo) => {
    if (!bot) { setSelectedHost(host); return; }
    const name = bot.name;
    Alert.alert(name, botSummary(bot), [
      { text: "Close", style: "cancel" },
      ...(inAppFeedbackEnabled(store.get().settings) ? [{ text: "Send feedback", onPress: () => {
        submitInAppFeedback({ kind: "select", text: `Selected bot ${bot.name}`, selection: { kind: "bot", id: bot.id, label: bot.name } });
        navigation.navigate("Chat");
      } }] : []),
    ]);
  }, [navigation]);
  const nodes = useMemo(() => botsTree(hosts, open, actions, Date.now(), conversations), [hosts, open, actions, conversations]);
  return <>
    <Tree nodes={nodes} label="Bots, harnesses and sessions" />
    {selectedHost && focused ? <Modal transparent animationType="fade" onRequestClose={() => setSelectedHost(null)}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close host info" onPress={() => setSelectedHost(null)} />
        <View testID="host-info-sheet" style={styles.sheet}>
          <Text style={styles.title}>{hostLabel(selectedHost)}</Text>
          <Text style={styles.detail}>{selectedHost.address ?? "No address"}</Text>
          <HostStatsRow key={selectedHost.id} hostId={selectedHost.id} />
          <Pressable accessibilityRole="button" onPress={() => setSelectedHost(null)} style={styles.close}><Text style={styles.detail}>Close</Text></Pressable>
        </View>
      </View>
    </Modal> : null}
  </>;
});
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { backgroundColor: colors.bg, padding: space.lg, paddingBottom: space.xl },
  title: { ...type.heading, color: colors.text },
  detail: { ...type.small, color: colors.textMuted },
  close: { minHeight: 44, justifyContent: "center", alignItems: "flex-end" },
});
