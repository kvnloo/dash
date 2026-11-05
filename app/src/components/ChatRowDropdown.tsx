import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { RowMenuOption, RowMenuOptionId } from "../lib/chat-row-menu";
import { colors, radius, space, type } from "../theme";

interface Anchor {
  x: number;
  y: number;
}

interface ChatRowDropdownProps {
  anchor: Anchor | null;
  title: string;
  options: readonly RowMenuOption[];
  onSelect(id: RowMenuOptionId): void;
  onClose(): void;
}

const EDGE = 12;
const ROW_HEIGHT = 48;

/** Row-anchored actions for native and web; long-press never invokes an action itself. */
export function ChatRowDropdown({ anchor, title, options, onSelect, onClose }: ChatRowDropdownProps) {
  const { width, height } = useWindowDimensions();
  if (!anchor) return null;

  const menuWidth = Math.min(260, Math.max(0, width - EDGE * 2));
  const menuHeight = options.length * ROW_HEIGHT + space.xs * 2;
  const left = Math.max(EDGE, Math.min(anchor.x - 24, width - menuWidth - EDGE));
  const below = anchor.y + EDGE;
  const top = below + menuHeight <= height - EDGE
    ? below
    : Math.max(EDGE, anchor.y - menuHeight - EDGE);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.layer}>
        <Pressable
          testID="chat-row-actions-backdrop"
          accessible={false}
          accessibilityElementsHidden
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          testID="chat-row-actions-menu"
          accessibilityRole="menu"
          accessibilityLabel={`Actions for ${title}`}
          style={[styles.menu, { left, top, width: menuWidth }]}
        >
          {options.map(option => (
            <Pressable
              key={option.id}
              testID={`chat-row-action-${option.id}`}
              accessibilityRole="button"
              accessibilityLabel={option.accessibilityLabel}
              onPress={() => onSelect(option.id)}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Text style={[styles.actionText, option.destructive && styles.destructive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.18)" },
  menu: {
    position: "absolute",
    paddingVertical: space.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    backgroundColor: colors.surfaceRaised,
    overflow: "hidden",
    elevation: 12,
  },
  action: {
    minHeight: ROW_HEIGHT,
    paddingHorizontal: space.lg,
    justifyContent: "center",
  },
  pressed: { backgroundColor: colors.surface },
  actionText: { ...type.body, color: colors.text },
  destructive: { color: colors.danger },
});
