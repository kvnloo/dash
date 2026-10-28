import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  requestTargetSwitch,
  targetBadgeText,
  targetSwitcherTree,
  type TargetSwitchIntent,
  type TargetSwitchResult,
  type TargetSwitcherInventory,
} from "../lib/target-switcher";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { Tree } from "./Tree";

export interface TargetSwitcherBadgeProps {
  /** The parent supplies an authenticated live roster and session/model evidence. */
  inventory: TargetSwitcherInventory;
  /**
   * A switch is a request, not a local route rewrite. For targets, open/resume an
   * exact conversation; for models, use a host-authorized session mutation.
   * Return ok only after acceptance. Never submit a slash command as chat text.
   */
  onSwitch(intent: TargetSwitchIntent): TargetSwitchResult | Promise<TargetSwitchResult>;
}

/** Window-dock routing control. Authenticated inventory and route changes come from ChatScreen. */
export function TargetSwitcherBadge({ inventory, onSwitch }: TargetSwitcherBadgeProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const badge = targetBadgeText(inventory);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const close = useCallback(() => {
    if (inFlight.current) return;
    setError(undefined);
    setOpen(false);
  }, []);

  const choose = useCallback(async (intent: TargetSwitchIntent): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    const result = await requestTargetSwitch(inventory, intent, onSwitch);
    inFlight.current = false;
    if (!mounted.current) return;
    setPending(false);
    if (result.ok) setOpen(false);
    else setError(result.reason);
  }, [inventory, onSwitch]);

  const tree = useMemo(
    () => targetSwitcherTree(inventory, intent => { void choose(intent); }),
    [inventory, choose],
  );

  return (
    <>
      <Pressable
        testID="target-switcher-badge"
        accessibilityRole="button"
        accessibilityLabel={badge.accessibilityLabel}
        accessibilityHint="Open the host, harness, profile, session and model tree"
        accessibilityState={{ expanded: open, busy: pending }}
        onPress={() => {
          if (inFlight.current) return;
          setError(undefined);
          setOpen(true);
        }}
        style={styles.badgeHit}
      >
        <GlassSurface variant="chip" borderRadius={radius.pill} style={styles.badgeGlass} contentStyle={styles.badgeContents}>
          <Feather name="git-branch" size={16} color={colors.textMuted} />
          <View style={styles.badgeText} accessible={false} importantForAccessibility="no-hide-descendants">
            <Text numberOfLines={1} style={styles.primary}>{badge.primary}</Text>
            <Text numberOfLines={1} style={styles.secondary}>{badge.secondary}</Text>
          </View>
          <Feather name="chevron-down" size={16} color={colors.textMuted} />
        </GlassSurface>
      </Pressable>

      <Modal
        visible={open}
        transparent
        statusBarTranslucent
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={close}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close target switcher"
            importantForAccessibility="no-hide-descendants"
            focusable={false}
            onPress={close}
          />
          <GlassSurface
            variant="raised"
            borderRadius={radius.lg}
            style={[styles.sheet, { height: Math.max(300, Math.min(window.height * 0.78, 620)) }]}
            contentStyle={[styles.sheetContent, { paddingBottom: Math.max(insets.bottom, space.md) }]}
            accessibilityViewIsModal
            onAccessibilityEscape={close}
          >
            <View style={styles.titleRow}>
              <View style={styles.titleGroup}>
                <Text accessibilityRole="header" style={styles.title}>Switch target</Text>
                <Text style={styles.description}>Host / harness / profile / session / model</Text>
              </View>
              <Pressable
                testID="target-switcher-close"
                accessibilityRole="button"
                accessibilityLabel="Close target switcher"
                accessibilityState={{ disabled: pending }}
                disabled={pending}
                onPress={close}
                style={styles.close}
              >
                <Feather name="x" size={21} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              <Tree
                nodes={tree.nodes}
                initialExpanded={tree.initialExpanded}
                inline
                label="Available hosts, harnesses, profiles, sessions and models"
              />
            </ScrollView>
            {pending ? (
              <Text accessibilityLiveRegion="polite" style={styles.feedback}>
                Requesting switch from the host…
              </Text>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Text style={styles.footnote}>
              Existing chats keep their route. Model changes require host approval.
            </Text>
          </GlassSurface>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badgeHit: {
    minHeight: controlMin,
    minWidth: controlMin,
    maxWidth: "100%",
    alignSelf: "flex-start",
    justifyContent: "center",
  },
  badgeGlass: { maxWidth: "100%" },
  badgeContents: {
    minHeight: controlMin,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    gap: space.sm,
  },
  badgeText: { flexShrink: 1, minWidth: 0 },
  primary: { ...type.label, color: colors.text },
  secondary: { ...type.mono, color: colors.textMuted, fontSize: 10 },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  sheetContent: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.lg },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  titleGroup: { flex: 1 },
  title: { ...type.cardTitle, color: colors.text },
  description: { ...type.small, color: colors.textMuted },
  close: {
    minWidth: controlMin,
    minHeight: controlMin,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hair,
  },
  list: { flex: 1, minHeight: 0, marginTop: space.md },
  listContent: { paddingBottom: space.md },
  feedback: { ...type.small, color: colors.textMuted, paddingVertical: space.sm },
  error: { ...type.small, color: colors.danger, paddingVertical: space.sm },
  footnote: { ...type.small, color: colors.textTertiary, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.hair, paddingTop: space.sm },
});
