import { Linking, Pressable, Text, View } from "react-native";
import { notificationState } from "../store/notifications";
import { disableNativeNotifications, enableNativeNotifications } from "../lib/native-notifications";
import { colors, space, type } from "../theme";
export function NotificationSettings() {
  const state = notificationState.use(s => s);
  return <View style={{ paddingVertical: space.md, gap: space.sm }}>
    <Text style={{ ...type.body, color: colors.text }}>Notifications</Text>
    <Text style={{ ...type.body, color: colors.textMuted }}>{state.available
      ? "Replies, action needed and errors. Silent, with no message previews or duplicate alerts while Dash is open. Works while Dash remains connected; delivery after Android suspends or closes Dash needs a push service."
      : "Notifications and incoming Android shares require the installed Dash build. Expo Go and web remain usable without them."}</Text>
    {state.available ? <>
      <Pressable accessibilityRole="button" onPress={() => void (state.enabled && state.permission === "granted" ? disableNativeNotifications() : enableNativeNotifications())} style={{ minHeight: 48, justifyContent: "center" }}>
        <Text style={{ ...type.body, color: colors.gold }}>{state.enabled && state.permission === "granted" ? "Disable notifications" : "Enable notifications"}</Text>
      </Pressable>
      <Text style={{ ...type.body, color: colors.textMuted }}>Android permission: {state.permission}</Text>
      <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()} style={{ minHeight: 48, justifyContent: "center" }}><Text style={{ ...type.body, color: colors.gold }}>Android notification settings</Text></Pressable>
    </> : null}
    {state.error ? <Text accessibilityRole="alert" style={{ ...type.body, color: colors.danger }}>{state.error}</Text> : null}
  </View>;
}
