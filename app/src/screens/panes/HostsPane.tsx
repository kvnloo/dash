import { sessionChats } from "../../lib/session-chats";
import { shallowArrayEqual } from "../../store/createStore";
import { memo, useCallback, useMemo } from "react";
import { Alert } from "react-native";
import type { AgentInfo, BotInfo, HostInfo } from "../../../../shared/protocol";
import { Tree } from "../../components/Tree";
import { hostsTree, hostLabel } from "../../lib/hosts-tree";
import { botSummary } from "../../lib/bots";
import { profileFromAgent } from "../../lib/roster";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import type { ScreenProps } from "../../navigation";
import { openAgentConversation, store } from "../../store/app";

export const HostsPane = memo(function HostsPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  const hosts = store.use(s => s.connection.hosts);
  // Only host sessions matter here; a phone-only chat changing must not re-render this pane.
  const conversations = store.useSelector(sessionChats, shallowArrayEqual);
  const open = useCallback((host: HostInfo, agent: AgentInfo) => {
    const result = openAgentConversation(profileFromAgent(host, agent));
    if ("error" in result) { Alert.alert("Session unavailable", result.error); return; }
    navigation.navigate("Chat");
  }, [navigation]);
  const actions = useCallback((host: HostInfo, bot?: BotInfo) => {
    const name = bot?.name ?? hostLabel(host);
    Alert.alert(name, bot ? botSummary(bot) : `${host.address ?? "No address"} · ${host.online ? "Online" : "Offline"}`, [
      { text: "Close", style: "cancel" },
      ...(bot && inAppFeedbackEnabled(store.get().settings) ? [{ text: "Send feedback", onPress: () => {
        submitInAppFeedback({ kind: "select", text: `Selected bot ${bot.name}`, selection: { kind: "bot", id: bot.id, label: bot.name } });
        navigation.navigate("Chat");
      } }] : []),
    ]);
  }, [navigation]);
  const nodes = useMemo(() => hostsTree(hosts, open, actions, Date.now(), conversations), [hosts, open, actions, conversations]);
  return <Tree nodes={nodes} label="Hosts, harnesses and sessions" />;
});
