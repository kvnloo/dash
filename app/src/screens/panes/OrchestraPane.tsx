import { sessionChats } from "../../lib/session-chats";
import { shallowArrayEqual } from "../../store/createStore";
import { memo, useMemo } from "react";
import { usePaneDimensions } from "../../lib/pane-size";
import { TraceEntryCard } from "../../components/trace/TraceEntryCard";
import { OrchestraGraph } from "../../components/OrchestraGraph";
import { AodlCatalogNetwork } from "../../components/AodlCatalogNetwork";
import { WorkspaceActions } from "../../components/WorkspaceHeader";
import { debugUi } from "../../debug/ui-store";
import { isDebugActive } from "../../debug/expose";
import { orchestraMotionFixture } from "../../debug/orchestra-fixture";
import { orchestraMap } from "../../lib/orchestra-map";
import { useOrchestraEvidence } from "../../lib/useOrchestraEvidence";
import { inAppFeedbackEnabled } from "../../lib/feedback";
import { submitInAppFeedback } from "../../lib/feedback-submit";
import type { ScreenProps } from "../../navigation";
import { setActive, openAgentConversation, store } from "../../store/app";

export const OrchestraPane = memo(function OrchestraPane({ navigation }: Pick<ScreenProps<"Main">, "navigation">) {
  // Only host sessions matter here; a phone-only chat changing must not re-render this pane.
  const conversations = store.useSelector(sessionChats, shallowArrayEqual);
  const settings = store.use(s => s.settings);
  const hosts = store.use(s => s.connection.hosts);
  const fixture = debugUi.use(s => s.orchestraFixture);
  const fixtureOn = isDebugActive() && fixture === true;
  const { width } = usePaneDimensions();
  const { snapshot, error } = useOrchestraEvidence(settings);
  const graph = useMemo(() => fixtureOn ? orchestraMotionFixture() : snapshot ? {
    nodes: snapshot.nodes.map(n => ({ ...n, thinking: n.state === "live" ? { phase: "thinking" as const } : { phase: "idle" as const } })),
    edges: snapshot.edges,
  } : orchestraMap(hosts, conversations), [hosts, conversations, fixtureOn, snapshot]);
  return <OrchestraGraph triageHeader={<TraceEntryCard onOpen={() => navigation.navigate("Trace")} />} graph={graph} width={width} fixture={fixtureOn} error={fixtureOn ? undefined : error} warnings={snapshot?.warnings} canOpen={node => Boolean(node.sessionId && (conversations.some(c => c.sessionId === node.sessionId) || hosts.some(h => `host:${h.id}` === node.hostId && h.self && h.online && h.agents.some(a => a.sessionId === node.sessionId))))} onFeedback={inAppFeedbackEnabled(settings) ? node => {
    submitInAppFeedback({ kind: "select", text: `Selected orchestra ${node.label}`, selection: { kind: "orchestra", id: node.id, label: node.label } });
    navigation.navigate("Chat");
  } : undefined} onOpen={node => {
    const chat = conversations.find(c => c.sessionId === node.sessionId);
    if (chat) { setActive(chat.id); navigation.navigate("Chat"); return; }
    const host = hosts.find(h => `host:${h.id}` === node.hostId);
    const agent = host?.agents.find(a => a.sessionId === node.sessionId);
    if (host && agent) {
      const result = openAgentConversation({ id: agent.id, role: agent.kind, description: agent.detail || "Bridge session", name: agent.name, harness: agent.kind, targetHostId: host.id, profileId: agent.id, sessionId: agent.sessionId, cwd: agent.cwd, online: host.online });
      if ("conversation" in result) navigation.navigate("Chat");
    }
  }} actions={<WorkspaceActions navigation={navigation} />}>
    <AodlCatalogNetwork />
    <TraceEntryCard onOpen={() => navigation.navigate("Trace")} />
  </OrchestraGraph>;
});
