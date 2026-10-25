import { Feather } from "@expo/vector-icons";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { effortIdForTurn, lastAssistantState, runtimeStateFromOrchestra, runtimeStateFromTurn } from "../catalog/runtime-state";
import { performSearchResultAction, SEARCH_RESULT_KIND_LABEL, searchResultAccessibility } from "../lib/a11y-search-result";
import type { SearchResult } from "../lib/global-search";
import { colors, space, type } from "../theme";
import { PressScale } from "./PressScale";
import { timeAgo } from "../util";
import { GlassSurface } from "./GlassSurface";
import { HarnessAvatar } from "./HarnessAvatar";

function resultTitle(item: SearchResult): string {
  switch (item.kind) {
    case "bot":
      return item.bot.name;
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
      return item.bot.name;
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
  if (item.kind === "harness") {
    return { stateId: item.available ? "paused" : "stale" };
  }
  return {};
}

export const SearchResultRow = memo(function SearchResultRow({
  item,
  onPress,
  onLongPress,
}: {
  item: SearchResult;
  onPress(item: SearchResult): void;
  onLongPress?(item: SearchResult): void;
}) {
  const title = resultTitle(item);
  const stale = item.kind === "conversation" && "stale" in item.conversation && item.conversation.stale === true;
  const meta =
    item.kind === "conversation"
      ? stale ? "ended" : timeAgo(item.conversation.updatedAt)
      : item.kind === "product"
        ? timeAgo(item.project.updatedAt)
        : item.kind === "bot" && item.bot.status === "running"
          ? "Running"
          : item.kind === "bot"
            ? "Not running"
            : item.kind === "harness"
              ? item.available
                ? "Available"
                : "Unavailable"
              : null;

  // Bots get a plain glyph: identity orbs mean a live agent or voice, not a messaging bot.
  const showFileIcon = item.kind === "file" || item.kind === "tool" || item.kind === "bot";
  const motion = avatarMotion(item);
  const a11y = searchResultAccessibility(item, {
    title,
    meta,
    hasLongPress: onLongPress !== undefined,
  });

  return (
    <PressScale
      onPress={() => { performSearchResultAction(item, "activate", onPress, onLongPress); }}
      onLongPress={onLongPress ? () => { performSearchResultAction(item, "longpress", onPress, onLongPress); } : undefined}
      delayLongPress={350}
      style={styles.row}
      accessible
      focusable
      accessibilityRole="button"
      accessibilityLabel={a11y.label}
      accessibilityHint={a11y.hint}
      accessibilityState={a11y.state}
      accessibilityActions={a11y.actions}
      onAccessibilityAction={(event) => {
        performSearchResultAction(item, event.nativeEvent.actionName, onPress, onLongPress);
      }}
    >
      {showFileIcon ? (
        <GlassSurface variant="chip" blur={false} borderRadius={24} style={styles.iconWrap}>
          <Feather
            name={item.kind === "file" ? "file-text" : item.kind === "bot" ? "message-circle" : "tool"}
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
          <Text style={[styles.title, stale && { color: colors.textTertiary }]} numberOfLines={1}>
            {title}
          </Text>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        </View>
        <Text style={[styles.subtitle, stale && { color: colors.textTertiary }]} numberOfLines={1}>
          {item.subtitle}
        </Text>
        <Text style={styles.kind}>{SEARCH_RESULT_KIND_LABEL[item.kind]}</Text>
      </View>
    </PressScale>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
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
  meta: { color: colors.textTertiary, ...type.mono, textTransform: "none", letterSpacing: 0 },
  subtitle: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  kind: {
    color: colors.textFaint,
    ...type.label,
    marginTop: 4,
  },
});
