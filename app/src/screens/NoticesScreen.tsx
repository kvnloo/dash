import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas } from "../components/Canvas";
import { GlassSurface } from "../components/GlassSurface";
import { ScreenHeader } from "../components/ScreenHeader";
import { openNotificationTarget } from "../lib/notification-routing";
import { parseNotificationTarget } from "../lib/notification-policy";
import { screenBack } from "../lib/screen-back";
import { fade } from "../motion";
import type { ScreenProps } from "../navigation";
import { agentNoticeInbox, noticeFailure, notices } from "../store/notices";
import { colors, radius, space, type } from "../theme";

export function NoticesScreen({ navigation }: ScreenProps<"Notices">) {
  const insets = useSafeAreaInsets();
  const { items, error } = notices.use(s => s);
  useEffect(() => { void agentNoticeInbox.hydrate().catch(noticeFailure); }, []);
  return <View style={[styles.screen, { paddingTop: insets.top }]}>
    <Canvas /><ScreenHeader title="Notices" onBack={() => screenBack(navigation)} />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
      <Text style={styles.help}>Agent reports · Last 50 received · No approval required</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!items.length ? <Text style={styles.help}>No notices yet. Reports from your paired bridge appear here, even when system notifications are off.</Text> : null}
      {items.map(notice => {
        const target = parseNotificationTarget({ url: notice.url });
        return <Animated.View key={notice.id} entering={FadeIn.duration(fade.duration).reduceMotion(ReduceMotion.System)}>
          <GlassSurface variant="surface" borderRadius={radius.md} contentStyle={styles.card}>
            <Text selectable style={styles.title}>{notice.title}</Text>
            <Text selectable style={styles.body}>{notice.body}</Text>
            {target && target.kind !== "notices" ? <Pressable accessibilityRole="button" onPress={() => openNotificationTarget(target)} style={styles.link}><Text style={styles.body}>Open in Dash →</Text></Pressable> : null}
            {notice.url && !target ? <Text selectable style={styles.help}>{notice.url}</Text> : null}
          </GlassSurface>
        </Animated.View>;
      })}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.md },
  card: { padding: space.lg, gap: space.sm },
  title: { ...type.cardTitle, color: colors.text },
  body: { ...type.body, color: colors.text },
  help: { ...type.small, color: colors.textMuted },
  error: { ...type.small, color: colors.danger },
  link: { minHeight: 48, justifyContent: "center" },
});
