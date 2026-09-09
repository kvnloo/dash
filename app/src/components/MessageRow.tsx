import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AssistantMessage, Message } from "../model";
import { colors, radius, space, type } from "../theme";
import { Markdown } from "./Markdown";
import { PulseDot } from "./PulseDot";

export const MessageRow = memo(function MessageRow({ message }: { message: Message }) {
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
      <AssistantBody message={message} />
    </View>
  );
});

function AssistantBody({ message }: { message: AssistantMessage }) {
  switch (message.state) {
    case "pending":
      return (
        <View style={styles.statusRow}>
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
            <PulseDot />
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
          <Text style={styles.noteText}>Connection to the bridge was lost mid-reply.</Text>
        </>
      );
    case "error":
      return (
        <>
          {message.text ? <Markdown text={message.text} /> : null}
          <Text selectable style={styles.errorText}>
            {message.error ?? "Something went wrong"}
          </Text>
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
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, minHeight: 20 },
  statusText: { color: colors.textMuted, ...type.small, flexShrink: 1 },
  noteText: { color: colors.textMuted, ...type.small, marginTop: 4 },
  errorText: { color: colors.danger, ...type.small, marginTop: 4 },
});
