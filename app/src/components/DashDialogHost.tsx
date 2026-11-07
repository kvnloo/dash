import { useCallback, useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import {
  dialogButtonLayout,
  dialogButtonOrder,
  dialogFirstFocusButtonId,
  dialogModalA11y,
  dialogTitleRole,
  dismissResult,
  type DashDialogRequest,
} from "../lib/a11y-dash-dialog";
import { colors, glass, radius, space, type } from "../theme";
import { GlassSurface } from "./GlassSurface";

/** Structurally compatible with the dialogStore.current request from #370. */
interface Props {
  request: DashDialogRequest | null;
  onResolve(id: string | null): void;
}

/**
 * Visual host only. Hermes mounts it at the app root and connects the dialog
 * store; no Alert.alert/native system prompt is used here.
 */
export function DashDialogHost({ request, onResolve }: Props) {
  const { width, fontScale } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const focusButtonRef = useRef<View | null>(null);
  const resolvedRequestRef = useRef<DashDialogRequest | null>(null);

  // Guard against a rapid double press resolving the NEXT queued dialog.
  const resolve = useCallback((id: string | null) => {
    if (request === null || resolvedRequestRef.current === request) return;
    resolvedRequestRef.current = request;
    onResolve(id);
  }, [request, onResolve]);

  const focusFirstButton = useCallback(() => {
    if (Platform.OS === "web") return;
    const node = findNodeHandle(focusButtonRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  // onShow handles initial mount. This also moves focus when a queued request
  // replaces the current request without the native Modal closing.
  useEffect(() => {
    if (request === null) return;
    const frame = requestAnimationFrame(focusFirstButton);
    return () => cancelAnimationFrame(frame);
  }, [request, focusFirstButton]);

  if (request === null) return null;

  const buttons = dialogButtonOrder(request.buttons);
  const firstFocusId = dialogFirstFocusButtonId(request.buttons);
  const cardWidth = Math.min(420, Math.max(0, width - 2 * space.xl));
  const availableButtonWidth = Math.max(0, cardWidth - 2 * space.xl);
  const layout = dialogButtonLayout(buttons, availableButtonWidth / Math.max(1, fontScale));
  const dismissId = dismissResult(request.buttons);

  // Android hardware Back and VoiceOver escape always dismiss; when there is
  // no cancel button, null is the store's unambiguous dismissal result.
  const handleBack = () => resolve(dismissId);
  // A backdrop tap is intentionally inert for non-cancellable dialogs.
  const handleBackdrop = () => {
    if (dismissId !== null) resolve(dismissId);
  };

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={handleBack}
      onShow={focusFirstButton}
    >
      <View style={styles.overlay}>
        <Pressable
          testID="dash-dialog-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={handleBackdrop}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <GlassSurface
          variant="raised"
          borderRadius={radius.lg}
          style={styles.card}
          contentStyle={styles.cardContent}
          {...dialogModalA11y}
          onAccessibilityEscape={handleBack}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            bounces={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text allowFontScaling accessibilityRole={dialogTitleRole} style={styles.title}>
              {request.title}
            </Text>
            {request.message ? (
              <Text allowFontScaling style={styles.message}>{request.message}</Text>
            ) : null}
            <View style={[styles.actions, layout === "row" ? styles.row : styles.column]}>
              {buttons.map((button) => (
                <Pressable
                  key={button.id}
                  ref={(node) => {
                    if (button.id === firstFocusId) focusButtonRef.current = node;
                  }}
                  testID={"dash-dialog-action-" + button.id}
                  accessibilityRole="button"
                  accessibilityLabel={button.label}
                  onPress={() => resolve(button.id)}
                  style={({ pressed }) => [
                    styles.button,
                    layout === "row" ? styles.rowButton : styles.columnButton,
                    button.role === "cancel" ? styles.cancelButton :
                      button.role === "destructive" ? styles.destructiveButton : styles.primaryButton,
                    pressed && (reducedMotion ? styles.pressedReduced : styles.pressed),
                  ]}
                >
                  <Text
                    allowFontScaling
                    style={[styles.buttonText, button.role === "cancel" ? styles.cancelText : styles.actionText]}
                  >
                    {button.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
    backgroundColor: "rgba(0,0,0,0.68)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "85%",
    backgroundColor: colors.surfaceRaised,
  },
  cardContent: { maxHeight: "100%" },
  scroll: { flexGrow: 0 },
  content: { padding: space.xl },
  title: { ...type.cardTitle, color: colors.text },
  message: { ...type.body, color: colors.textMuted, marginTop: space.md },
  actions: { marginTop: space.xl, gap: space.sm, alignItems: "stretch" },
  row: { flexDirection: "row" },
  column: { flexDirection: "column" },
  button: {
    minWidth: 44,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rowButton: { flex: 1 },
  columnButton: { alignSelf: "stretch" },
  cancelButton: { backgroundColor: glass.fillNavStrong, borderColor: glass.borderBright },
  destructiveButton: { backgroundColor: colors.danger, borderColor: colors.danger },
  primaryButton: { backgroundColor: colors.gold, borderColor: colors.goldRim },
  buttonText: { ...type.heading, textAlign: "center" },
  cancelText: { color: colors.text },
  actionText: { color: colors.onAccent },
  pressed: { transform: [{ scale: 0.985 }] },
  pressedReduced: { opacity: 0.85 },
});
