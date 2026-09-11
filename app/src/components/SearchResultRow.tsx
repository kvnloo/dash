import { Ionicons } from "@expo/vector-icons";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { effortIdForTurn, lastAssistantState, runtimeStateFromAgent, runtimeStateFromOrchestra, runtimeStateFromTurn } from "../catalog/runtime-state";
import type { SearchResult } from "../lib/global-search";
import { colors, space, type } from "../theme";
import { PressScale } from "./PressScale";
import { timeAgo } from "../util";
import { GlassSurface } from "./GlassSurface";
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


function avatarHarnessId(item: SearchResult): string | undefined {
  switch (item.kind) {
    case "bot":
      return item.profile.harness;
    case "conversation":
      return item.conversation.harness;
    case "harness":
      return item.id;
    default:
      return undefined;
  }
}

function avatarMotion(item: SearchResult): { effortId?: string; stateId?: string } {
  if (item.kind === "conversation") {
    const turnState = lastAssistantState(item.conversation.messages);
    return {
      effortId: effortIdForTurn({ turnState }),
      stateId: runtimeStateFromTurn({ turnState }),
    };
  }
  if (item.kind === "product") {
    return {
      stateId: runtimeStateFromOrchestra({ status: item.project.status, streaming: false }),
    };
  }
  if (item.kind === "bot") {
    return { stateId: runtimeStateFromAgent(item.profile.online ? "available" : "offline") };
  }
  if (item.kind === "harness") {
    return { stateId: item.available ? "paused" : "stale" };
  }
  return {};
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

  const showFileIcon = item.kind === "file" || item.kind === "tool";
  const motion = avatarMotion(item);

  return (
    <PressScale
      onPress={() => onPress(item)}
      style={styles.row}
      accessibilityRole="button"
    >
      {showFileIcon ? (
        <GlassSurface variant="chip" blur={false} borderRadius={24} style={styles.iconWrap}>
          <Ionicons
            name={item.kind === "file" ? "document-text-outline" : "construct-outline"}
            size={22}
            color={colors.textMuted}
          />
        </GlassSurface>
      ) : (
        <HarnessAvatar
          name={avatarName(item)}
          harnessId={avatarHarnessId(item)}
          effortId={motion.effortId}
          stateId={motion.stateId}
        />
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
    </PressScale>
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
  iconWrap: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
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
});
