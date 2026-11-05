import { Pressable, StyleSheet, Text } from "react-native";
import type { CompactToolRowModel } from "../lib/compact-tool-row";
import { colors, glass, space, type } from "../theme";

export interface CompactToolRowProps {
  model: CompactToolRowModel;
  /** The caller owns the full/retained tool details and selected call identity. */
  onExpand(): void;
  testID?: string;
  /** Set on a coalesced row that lists its calls inline; omit on a row that opens details. */
  expanded?: boolean;
}

/** One dense line per tool call (or per run of adjacent identical calls); ReplyBlocks lists them. */
export function CompactToolRow({ model, onExpand, testID, expanded }: CompactToolRowProps) {
  const statusColor = model.status === "error" ? colors.danger
    : model.status === "running" ? colors.warn : colors.ok;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={model.accessibilityLabel}
      accessibilityHint={expanded === undefined ? "Open tool call details" : "Show each call"}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onExpand}
      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} ellipsizeMode="middle" style={styles.line}>
        <Text style={styles.glyph}>{model.glyph} </Text>
        <Text style={styles.verb}>
          {model.verb}{model.count && model.count > 1 ? " ×" + model.count : ""}
        </Text>
        <Text style={styles.target}>{" · "}{model.target}</Text>
        <Text style={{ color: statusColor }}>{" · "}{model.status}</Text>
        {model.durationLabel ? (
          <Text style={styles.duration}>{" · "}{model.durationLabel}</Text>
        ) : null}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The visible row is dense; 6 DIP hit slop on both vertical sides gives 44 DIP.
  row: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.hair,
    backgroundColor: glass.fill,
  },
  pressed: { backgroundColor: glass.fillChipOn },
  line: { ...type.mono, color: colors.textMuted, flexShrink: 1 },
  glyph: { color: colors.textTertiary },
  verb: { color: colors.text },
  target: { color: colors.textMuted },
  duration: { color: colors.textTertiary },
});
