import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { effortIdForTurn, runtimeStateFromTurn } from "../catalog/runtime-state";
import { loadVisualCatalog, providerIdForHarness, resolveEffort, resolveProvider, resolveRuntimeState } from "../catalog/visual";
import type { AssistantMessage, AssistantState, Message } from "../model";
import { colors, radius, space, type } from "../theme";
import { EffortOrbs } from "./EffortOrbs";
import { Markdown } from "./Markdown";
import { OrchestraCore } from "./TopologyBadge";

export const MessageRow = memo(function MessageRow({
  message,
  harnessId,
}: {
  message: Message;
  harnessId?: string;
}) {
  if (message.role === "user") {
    return (
      <View style={styles.userRow}>
        <View style={styles.bubble}>
          <Text selectable style={styles.userText}>
            {message.text}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.assistantRow}>
      <AssistantBody message={message} harnessId={harnessId} />
    </View>
  );
});

function ThinkingMarker({ harnessId, turnState }: { harnessId?: string; turnState: AssistantState }) {
  const catalog = loadVisualCatalog();
  const provider = resolveProvider(catalog, providerIdForHarness(harnessId ?? ""));
  const effort = resolveEffort(catalog, effortIdForTurn({ turnState }));
  const state = resolveRuntimeState(catalog, runtimeStateFromTurn({ turnState }));
  return (
    <EffortOrbs hue={provider.hue} size={22} effort={effort} state={state}>
      <OrchestraCore hue={provider.hue} size={16} />
    </EffortOrbs>
  );
}

function AssistantBody({ message, harnessId }: { message: AssistantMessage; harnessId?: string }) {
  switch (message.state) {
    case "pending":
      return (
        <View style={styles.statusRow}>
          <ThinkingMarker harnessId={harnessId} turnState={message.state} />
          <Text style={styles.statusText} numberOfLines={1}>
            Queued…
          </Text>
        </View>
      );
    case "streaming":
      return (
        <>
          {message.text ? <Markdown text={message.text} /> : null}
          <View style={styles.statusRow}>
            <ThinkingMarker harnessId={harnessId} turnState={message.state} />
            <Text style={styles.statusText} numberOfLines={1}>
              {message.status ?? "Working"}
            </Text>
          </View>
        </>
      );
    case "done":
      return <Markdown text={message.text} />;
    case "interrupted":
      return (
        <>
          {message.text ? <Markdown text={message.text} /> : null}
          <View style={styles.statusRow}>
            <ThinkingMarker harnessId={harnessId} turnState={message.state} />
            <Text style={styles.noteText}>Connection to the bridge was lost mid-reply.</Text>
          </View>
        </>
      );
    case "error":
      return (
        <>
          {message.text ? <Markdown text={message.text} /> : null}
          <View style={styles.statusRow}>
            <ThinkingMarker harnessId={harnessId} turnState={message.state} />
            <Text selectable style={styles.errorText}>
              {message.error ?? "Something went wrong"}
            </Text>
          </View>
        </>
      );
    default: {
      const _exhaustive: never = message.state;
      return _exhaustive;
    }
  }
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  bubble: {
    maxWidth: "82%",
    backgroundColor: colors.bubble,
    borderRadius: radius.lg,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: { color: colors.text, ...type.body },
  assistantRow: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  assistantText: { color: colors.text, ...type.body },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, minHeight: 22 },
  statusText: { color: colors.textMuted, ...type.small, flexShrink: 1 },
  noteText: { color: colors.textMuted, ...type.small, flexShrink: 1 },
  errorText: { color: colors.danger, ...type.small, flexShrink: 1 },
});
