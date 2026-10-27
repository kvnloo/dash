import { useEffect, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHandedness } from "../lib/useHandedness";
import { LIMIT_LABEL } from "../lib/attachments";
import { colors, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";

export interface AttachmentAnchor { x: number; y: number; width: number; height: number }

/** The same raised glass / themed rows as HarnessPicker, anchored to the paperclip. */
export function AttachmentChooser({ anchor, onClose, onPick }: {
  anchor: AttachmentAnchor;
  onClose(): void;
  onPick(kind: "photos" | "files"): void;
}) {
  const thumb = useHandedness();
  const titleRef = useRef<Text>(null);
  const [pendingPick, setPendingPick] = useState<"photos" | "files" | null>(null);
  const choose = (kind: "photos" | "files") => {
    // iOS cannot present its OS picker over a still-presented Modal controller.
    if (Platform.OS === "ios") setPendingPick(kind);
    else onPick(kind);
  };
  const window = useWindowDimensions();
  const measuredWindow = useRef({ width: window.width, height: window.height });
  const insets = useSafeAreaInsets();
  const width = Math.min(300, window.width - insets.left - insets.right - 24);
  const left = Math.max(insets.left + 12, Math.min(window.width - insets.right - width - 12,
    thumb.side === "left" ? anchor.x : anchor.x + anchor.width - width));
  const bottom = Math.max(insets.bottom + 12, window.height - anchor.y + 8);
  const focusTitle = () => {
    if (Platform.OS === "web") return;
    const node = findNodeHandle(titleRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  };
  // Rotation/resizing invalidates the measured anchor. Reopen against the new layout.
  useEffect(() => {
    if (window.width !== measuredWindow.current.width || window.height !== measuredWindow.current.height) onClose();
  }, [window.width, window.height, onClose]);
  return <Modal transparent visible={pendingPick === null} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onShow={focusTitle} onDismiss={() => { if (pendingPick) onPick(pendingPick); }}>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onClose} />
      <GlassSurface testID="attachment-sheet" variant="raised" accessibilityLabel="Attachment chooser" accessibilityViewIsModal borderRadius={radius.md} style={[styles.sheet, { left, bottom, width }]} contentStyle={{ maxHeight: Math.max(44, anchor.y - insets.top - 16) }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text ref={titleRef} style={styles.title} accessibilityRole="header" accessibilityLabel="Attachment chooser">Attach</Text>
          <Text style={styles.hint}>Up to {LIMIT_LABEL} per file, sent to the paired computer over Tailscale.</Text>
          <PressScale accessibilityRole="button" accessibilityLabel="Photos" accessibilityHint="Choose photos to attach" onPress={() => choose("photos")} style={[styles.row, thumb.row]}>
            <Feather name="image" size={18} color={colors.textMuted} /><Text style={styles.label}>Photos</Text>
          </PressScale>
          <PressScale accessibilityRole="button" accessibilityLabel="Files" accessibilityHint="Choose files to attach" onPress={() => choose("files")} style={[styles.row, thumb.row]}>
            <Feather name="file" size={18} color={colors.textMuted} /><Text style={styles.label}>Files</Text>
          </PressScale>
          <PressScale accessibilityRole="button" accessibilityLabel="Cancel attachment" accessibilityHint="Close without choosing an attachment" onPress={onClose} style={[styles.row, thumb.row]}><Text style={styles.label}>Cancel</Text></PressScale>
        </ScrollView>
      </GlassSurface>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  sheet: { position: "absolute", backgroundColor: colors.surfaceRaised },
  content: { padding: space.sm },
  title: { ...type.cardTitle, color: colors.gold, paddingHorizontal: space.sm, paddingTop: space.sm },
  hint: { ...type.small, color: colors.textMuted, padding: space.sm },
  row: { minHeight: 44, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "flex-start", paddingHorizontal: space.sm, borderRadius: radius.md },
  label: { ...type.heading, color: colors.text, flexShrink: 1 },
});