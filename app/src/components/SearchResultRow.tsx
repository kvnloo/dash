import { Feather } from "@expo/vector-icons";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
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
  model,
  onPress,
  onLongPress,
}: {
  model: SearchRowModel;
  onPress(model: SearchRowModel): void;
  onLongPress?(model: SearchRowModel): void;
}) {
  const stale = model.stale;
  return (
    <PressScale
      onPress={() => onPress(model)}
      onLongPress={onLongPress ? () => onLongPress(model) : undefined}
      delayLongPress={350}
      style={styles.row}
      accessibilityRole="button"
    >
      {model.icon ? (
        // Bots get a plain glyph: identity orbs mean a live agent or voice, not a messaging bot.
        <GlassSurface variant="chip" blur={false} borderRadius={24} style={styles.iconWrap}>
          <Feather name={model.icon} size={22} color={colors.textMuted} />
        </GlassSurface>
      ) : (
        <HarnessAvatar name={model.avatarName} harnessId={model.harnessId} effortId={model.effortId} stateId={model.stateId} />
      )}
      <View style={styles.main}>
        <View style={styles.top}>
          <Text style={[styles.title, stale && styles.faded]} numberOfLines={1}>
            {model.title}
          </Text>
          {model.meta ? <Text style={styles.meta}>{model.meta}</Text> : null}
        </View>
        <Text style={[styles.subtitle, stale && styles.faded]} numberOfLines={1}>
          {model.segments.map((segment, index) => segment.hit
            ? <Text key={index} style={styles.hit}>{segment.text}</Text>
            : segment.text)}
        </Text>
        <Text style={styles.kind}>{model.kindLabel}</Text>
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
