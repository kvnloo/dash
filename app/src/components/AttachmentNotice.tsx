import { Feather } from "@expo/vector-icons";
import { useMemo, useRef } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import { colors, glass, radius, space, type } from "../theme";
import {
  attachmentNoticeView,
  createAttachmentNoticeController,
  type AttachmentNoticeHandlers,
  type AttachmentNoticeRequest,
} from "../lib/attachment-notice";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";

interface Props extends AttachmentNoticeHandlers {
  request: AttachmentNoticeRequest;
}

/** In-app attachment notices and consent, using Dash chrome rather than Android Alert. */
export function AttachmentNotice({ request, onDismiss, onConfirmUpload }: Props) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const titleRef = useRef<Text>(null);
  const handlers = useRef<AttachmentNoticeHandlers>({ onDismiss, onConfirmUpload });
  handlers.current = { onDismiss, onConfirmUpload };

  // Keep the same one-shot decision gate if the parent callbacks change.
  const dispatch = useMemo(() => createAttachmentNoticeController(request, {
    onDismiss: () => handlers.current.onDismiss(),
    onConfirmUpload: () => handlers.current.onConfirmUpload(),
  }), [request]);
  const notice = attachmentNoticeView(request);
  const secondary = notice.secondary;
  const close = () => { dispatch("dismiss"); };
  const focusHeading = () => {
    if (Platform.OS === "web") return;
    const node = findNodeHandle(titleRef.current);
    if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
  };

  return (
    <Modal
      transparent
      visible
      animationType={reducedMotion ? "none" : "fade"}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
      onShow={focusHeading}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessible={false}
          focusable={false}
          importantForAccessibility="no-hide-descendants"
        />
        <GlassSurface
          variant="raised"
          borderRadius={radius.lg}
          style={[styles.sheet, {
            marginBottom: Math.max(insets.bottom, space.md),
            maxHeight: Math.max(0, window.height - insets.top - insets.bottom - space.xl),
          }]}
          accessibilityViewIsModal
          accessibilityPaneTitle={notice.title}
          onAccessibilityEscape={close}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <Text ref={titleRef} accessibilityRole="header" style={styles.title}>{notice.title}</Text>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel="Close attachment notice"
                onPress={close}
                style={styles.close}
              >
                <Feather name="x" size={20} color={colors.textMuted} />
              </PressScale>
            </View>
            <Text style={styles.detail}>{notice.detail}</Text>
            <View style={styles.actions}>
              {secondary ? (
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={secondary.label}
                  onPress={() => { dispatch(secondary.action); }}
                  style={[styles.action, styles.secondary]}
                >
                  <Text style={styles.secondaryLabel}>{secondary.label}</Text>
                </PressScale>
              ) : null}
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={notice.primary.label}
                onPress={() => { dispatch(notice.primary.action); }}
                style={[styles.action, styles.primary]}
              >
                <Text style={styles.primaryLabel}>{notice.primary.label}</Text>
              </PressScale>
            </View>
          </ScrollView>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "flex-end",
  },
  sheet: {
    marginHorizontal: space.md,
    backgroundColor: colors.surfaceRaised,
  },
  content: {
    padding: space.lg,
    gap: space.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  title: {
    ...type.cardTitle,
    color: colors.text,
    flex: 1,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  detail: {
    ...type.body,
    color: colors.textMuted,
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginTop: space.sm,
  },
  action: {
    minHeight: 48,
    minWidth: 112,
    flexGrow: 1,
    flexShrink: 1,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    backgroundColor: glass.fillChipOn,
    borderColor: colors.gold,
  },
  secondary: {
    backgroundColor: glass.fill,
    borderColor: glass.hair,
  },
  primaryLabel: {
    ...type.heading,
    color: colors.gold,
    textAlign: "center",
  },
  secondaryLabel: {
    ...type.heading,
    color: colors.text,
    textAlign: "center",
  },
});
