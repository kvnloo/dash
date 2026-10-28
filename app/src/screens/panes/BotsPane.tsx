import { sessionChats } from "../../lib/session-chats";
import { useHostUtilization } from "../../lib/useHostUtilization";
import { utilizationLabel } from "../../../../shared/host-utilization";
import { shallowArrayEqual } from "../../store/createStore";
import { memo, useCallback, useMemo } from "react";
import { Alert } from "react-native";
import type { AgentInfo, BotInfo, HostInfo } from "../../../../shared/protocol";
import { Tree } from "../../components/Tree";
import { botsTree, hostLabel } from "../../lib/bots-tree";
import { botSummary } from "../../lib/bots";
import { profileFromAgent } from "../../lib/roster";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import type { ScreenProps } from "../../navigation";
import { openAgentConversation, store } from "../../store/app";

export const BotsPane = memo(function BotsPane({ navigation, focused }: Pick<ScreenProps<"Main">, "navigation"> & { focused: boolean }) {
  const hosts = store.use(s => s.connection.hosts);
  const settings = store.use(s => s.settings);
  const utilization = useHostUtilization(settings, focused);
  // Only host sessions matter here; a phone-only chat changing must not re-render this pane.
  const conversations = store.useSelector(sessionChats, shallowArrayEqual);
  const open = useCallback((host: HostInfo, agent: AgentInfo) => {
    const result = openAgentConversation(profileFromAgent(host, agent));
    if ("error" in result) { Alert.alert("Session unavailable", result.error); return; }
    navigation.navigate("Chat");
  }, [navigation]);
  const actions = useCallback((host: HostInfo, bot?: BotInfo) => {
    const name = bot?.name ?? hostLabel(host);
    const usage = utilization?.hosts.find(h => h.hostId === host.id);
    const week = usage?.week;
    const weekLabel = week?.utilization === null || !week ? "7d utilization n/a" : `7d utilization ${Math.round(week.utilization)}% · ${Math.round(week.coverage * 100)}% coverage`;
    Alert.alert(name, bot ? botSummary(bot) : `${host.address ?? "No address"} · ${host.online ? "Online" : "Offline"}\n${utilizationLabel(usage)}\n${weekLabel}\nBusy = CPU (or GPU) at 70% or more for a minute. Utilization is busy time divided by observed time.`, [
      { text: "Close", style: "cancel" },
      ...(bot && inAppFeedbackEnabled(store.get().settings) ? [{ text: "Send feedback", onPress: () => {
        submitInAppFeedback({ kind: "select", text: `Selected bot ${bot.name}`, selection: { kind: "bot", id: bot.id, label: bot.name } });
        navigation.navigate("Chat");
      } }] : []),
    ]);
  }, [navigation, utilization]);
  const nodes = useMemo(() => botsTree(hosts, open, actions, Date.now(), conversations).map((node, index) => ({
    ...node, detail: `${utilizationLabel(utilization?.hosts.find(h => h.hostId === hosts[index]?.id))}${node.detail ? ` · ${node.detail}` : ""}`,
  })), [hosts, open, actions, conversations, utilization]);
  return <Tree nodes={nodes} label="Bots, harnesses and sessions" />;
});
