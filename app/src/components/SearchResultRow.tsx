import { Feather } from "@expo/vector-icons";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { performSearchResultAction, searchRowAccessibility } from "../lib/a11y-search-result";
import type { SearchRowModel } from "../lib/chat-search";
import { colors, space, type } from "../theme";
import { PressScale } from "./PressScale";
import { GlassSurface } from "./GlassSurface";
import { HarnessAvatar } from "./HarnessAvatar";

/**
 * One search result. Props are a precomputed row model (title, time label, snippet segments,
 * avatar state), never a Conversation, so a row re-renders only when its own model changes.
 */
export const SearchResultRow = memo(function SearchResultRow({
  model: item,
  onPress,
  onLongPress,
}: {
  model: SearchRowModel;
  onPress(model: SearchRowModel): void;
  onLongPress?(model: SearchRowModel): void;
}) {
  const stale = item.stale;
  // Runtime motion (effort, state) is precomputed in the row model and drives the avatar.
  const motion = { effortId: item.effortId, stateId: item.stateId };
  const a11y = searchRowAccessibility(item, { hasLongPress: onLongPress !== undefined });
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
      {item.icon ? (
        // Bots get a plain glyph: identity orbs mean a live agent or voice, not a messaging bot.
        <GlassSurface variant="chip" blur={false} borderRadius={24} style={styles.iconWrap}>
          <Feather name={item.icon} size={22} color={colors.textMuted} />
        </GlassSurface>
      ) : (
        <HarnessAvatar name={item.avatarName} harnessId={item.harnessId} effortId={motion.effortId} stateId={motion.stateId} />
      )}
      <View style={styles.main}>
        <View style={styles.top}>
          <Text style={[styles.title, stale && styles.faded]} numberOfLines={1}>
            {item.title}
          </Text>
          {item.meta ? <Text style={styles.meta}>{item.meta}</Text> : null}
        </View>
        <Text style={[styles.subtitle, stale && styles.faded]} numberOfLines={1}>
          {item.segments.map((segment, index) => segment.hit
            ? <Text key={index} style={styles.hit}>{segment.text}</Text>
            : segment.text)}
        </Text>
        <Text style={styles.kind}>{item.kindLabel}</Text>
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
  faded: { color: colors.textTertiary },
  meta: { color: colors.textTertiary, ...type.mono, textTransform: "none", letterSpacing: 0 },
  subtitle: { color: colors.textMuted, ...type.small, marginTop: 2, textTransform: "none", letterSpacing: 0 },
  hit: { color: colors.gold },
  kind: {
    color: colors.textFaint,
    ...type.label,
    marginTop: 4,
  },
});
