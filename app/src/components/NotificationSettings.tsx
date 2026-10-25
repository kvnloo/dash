import { Linking, Pressable, Text, View } from "react-native";
import { notificationState } from "../store/notifications";
import { disableNativeNotifications, enableNativeNotifications } from "../lib/native-notifications";
import { colors, space, type } from "../theme";
import { notificationToggleAccessibility } from "../lib/a11y-notification-settings";
export function NotificationSettings() {
  const state = notificationState.use(s => s);
  const a11y = notificationToggleAccessibility(state);
  return <View style={{ paddingVertical: space.md, gap: space.sm }}>
    <Text style={{ ...type.body, color: colors.text }}>Notifications</Text>
    <Text style={{ ...type.body, color: colors.textMuted }}>{state.available
      ? "Replies, action needed and errors. Silent, with no message previews or duplicate alerts while Dash is open. Works while Dash remains connected; delivery after Android suspends or closes Dash needs a push service."
      : "Notifications and incoming Android shares require the installed Dash build. Expo Go and web remain usable without them."}</Text>
    {a11y.visible ? <>
      <Pressable
        accessible
        accessibilityRole="switch"
        accessibilityLabel={a11y.label}
        accessibilityHint={a11y.hint}
        accessibilityState={{ checked: a11y.checked, disabled: a11y.disabled }}
        disabled={a11y.disabled}
        onPress={() => void (a11y.checked ? disableNativeNotifications() : enableNativeNotifications())}
        style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ ...type.body, color: a11y.disabled ? colors.textMuted : colors.gold }}>{a11y.actionLabel}</Text>
      </Pressable>
      <Text accessibilityLiveRegion="polite" style={{ ...type.body, color: colors.textMuted }}>{a11y.permissionLabel}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Dash app settings in Android"
        accessibilityHint="Review notification permissions in Android settings."
        onPress={() => void Linking.openSettings()}
        style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ ...type.body, color: colors.gold }}>Android notification settings</Text>
      </Pressable>
    </> : null}
    {state.error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel={`Notification error: ${state.error}`} style={{ ...type.body, color: colors.danger }}>{state.error}</Text> : null}
  </View>;
}
