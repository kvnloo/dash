import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArtifactStage } from "../components/artifact-stage/ArtifactStage";
import { ScreenHeader } from "../components/ScreenHeader";
import { forDash, isStageUrl, stageLabel } from "../lib/stage-link";
import type { ScreenProps } from "../navigation";
import { colors, space, type } from "../theme";

/** One ephemeral artifact review, opened from a chat reply or an approval item. */
export function ArtifactStageScreen({ navigation, route }: ScreenProps<"ArtifactStage">) {
  const insets = useSafeAreaInsets();
  const url = route.params?.url ?? "";
  const ok = isStageUrl(url);
  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Main"));
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader compact title={route.params?.title ?? (ok ? `Stage · ${stageLabel(url)}` : "Stage")} onBack={back} />
      {ok ? (
        <View style={[styles.stage, { paddingBottom: insets.bottom }]}>
          <ArtifactStage url={forDash(url)} title={route.params?.title} />
        </View>
      ) : (
        <Text style={styles.note}>This is not an artifact-stage review link (tailnet or loopback host with a review token).</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  stage: { flex: 1 },
  note: { ...type.body, color: colors.textMuted, padding: space.lg },
});
