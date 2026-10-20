import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AssistantMessage, AssistantState, Message } from "../model";
import { replyText, useKeyed } from "../store/text";
import { colors, radius, space, type } from "../theme";
import { Markdown } from "./Markdown";

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

function ThinkingMarker({ turnState, waiting = false }: { harnessId?: string; turnState: AssistantState; waiting?: boolean }) {
  // A reply held for a host handoff is not work in progress: faint, never gold.
  const color = waiting ? colors.textTertiary : turnState === "done" ? colors.ok : turnState === "error" ? colors.danger : colors.gold;
  return <View accessibilityLabel={waiting ? "queued" : turnState} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />;
}

function AssistantBody({ message, harnessId }: { message: AssistantMessage; harnessId?: string }) {
  const liveText = useKeyed(replyText, message.turnId);
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
          {liveText || message.text ? <Markdown text={liveText || message.text} /> : null}
          <View style={styles.statusRow}>
            <ThinkingMarker harnessId={harnessId} turnState={message.state} waiting={message.handoff === "queued"} />
            <Text style={styles.statusText} numberOfLines={2}>
              {message.status ?? "Working"}
            </Text>
          </View>
        </>
      );
    case "done":
      return <><Markdown text={message.text} />{message.status ? <View style={styles.statusRow}><ThinkingMarker turnState="done" /><Text style={styles.statusText}>Done · {message.status}</Text></View> : null}</>;
    case "interrupted":
      return (
        <>
          {message.text ? <Markdown text={message.text} /> : null}
          <View style={styles.statusRow}>
            <ThinkingMarker harnessId={harnessId} turnState={message.state} />
            <Text style={styles.noteText}>{message.status ?? "Connection to the bridge was lost mid-reply."}</Text>
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
    borderBottomRightRadius: 8,
    borderWidth: 1,
    borderColor: colors.hair,
    borderTopColor: "rgba(255,255,255,.18)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: { color: colors.text, ...type.body },
  assistantRow: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  assistantText: { color: colors.text, ...type.body },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, minHeight: 22 },
  statusText: { color: colors.textTertiary, ...type.mono, flexShrink: 1 },
  noteText: { color: colors.textMuted, ...type.small, flexShrink: 1 },
  errorText: { color: colors.danger, ...type.small, flexShrink: 1 },
});
