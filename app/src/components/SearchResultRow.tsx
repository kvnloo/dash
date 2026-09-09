import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SearchResult } from "../lib/global-search";
import { colors, space, type } from "../theme";
import { timeAgo } from "../util";
import { HarnessAvatar } from "./HarnessAvatar";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  bot: "Bot",
  conversation: "Chat",
  product: "Product",
  harness: "Harness",
  skill: "Skill",
  plugin: "Plugin",
  tool: "Tool",
  file: "File",
};

function resultTitle(item: SearchResult): string {
  switch (item.kind) {
    case "bot":
      return item.profile.name;
    case "conversation":
      return item.conversation.title || item.harnessName;
    case "product":
      return item.project.name;
    case "harness":
      return item.name;
    case "skill":
      return item.skill.name;
    case "plugin":
      return item.plugin.name;
    case "tool":
      return item.tool.name;
    case "file":
      return item.file.path;
  }
}

function avatarName(item: SearchResult): string {
  switch (item.kind) {
    case "bot":
      return item.profile.name;
    case "conversation":
      return item.harnessName;
    case "product":
      return item.project.name;
    case "harness":
      return item.name;
    case "skill":
      return item.skill.name;
    case "plugin":
      return item.plugin.name;
    case "tool":
      return item.tool.name;
    case "file":
      return item.file.path.split("/").pop() ?? item.file.path;
  }
}

export const SearchResultRow = memo(function SearchResultRow({
  item,
  onPress,
}: {
  item: SearchResult;
  onPress(item: SearchResult): void;
}) {
  const title = resultTitle(item);
  const meta =
    item.kind === "conversation"
      ? timeAgo(item.conversation.updatedAt)
      : item.kind === "product"
        ? timeAgo(item.project.updatedAt)
        : item.kind === "bot" && item.profile.online
          ? "Online"
          : item.kind === "bot"
            ? "Offline"
            : item.kind === "harness"
              ? item.available
                ? "Available"
                : "Unavailable"
              : null;

  const streaming =
    item.kind === "conversation" &&
    item.conversation.messages.some((m) => m.role === "assistant" && m.state === "streaming");

  const showFileIcon = item.kind === "file" || item.kind === "tool";

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      {showFileIcon ? (
        <View style={styles.iconWrap}>
          <Ionicons
            name={item.kind === "file" ? "document-text-outline" : "construct-outline"}
            size={22}
            color={colors.textMuted}
          />
        </View>
      ) : (
        <HarnessAvatar name={avatarName(item)} />
      )}
      <View style={styles.main}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>
          {item.subtitle}
        </Text>
        <Text style={styles.kind}>{KIND_LABEL[item.kind]}</Text>
      </View>
      {streaming ? <View style={styles.dot} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.85 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  main: { flex: 1, minWidth: 0 },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { color: colors.text, ...type.heading, flex: 1 },
  meta: { color: colors.textMuted, ...type.small, textTransform: "none", letterSpacing: 0 },
  subtitle: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  kind: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text, opacity: 0.7 },
});
