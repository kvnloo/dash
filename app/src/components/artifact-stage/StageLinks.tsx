import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import { stageLabel, stageLinks } from "../../lib/stage-link";
import type { RootStackParamList } from "../../navigation";
import { colors, fonts, glass, radius, type } from "../../theme";
import { PressScale } from "../PressScale";

/** "Open in stage" pills for artifact-stage review links in a reply or an approval item. */
export function StageLinks({ text, label }: { text: string; label?: string }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const links = stageLinks(text);
  if (!links.length) return null;
  return (
    <View style={styles.row}>
      {links.map((url) => (
        <PressScale key={url} accessibilityRole="button" accessibilityLabel={`Open ${label ?? "review"} in stage`} onPress={() => nav.navigate("ArtifactStage", { url, title: label })} style={styles.pill}>
          <Feather name="box" size={13} color={colors.gold} />
          <Text style={styles.name} numberOfLines={1}>{label ?? stageLabel(url)}</Text>
          <Text style={styles.action}>Open in stage</Text>
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, maxWidth: "100%", paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: glass.fillChip, borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight },
  name: { ...type.mono, color: colors.textMuted, flexShrink: 1 },
  action: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.gold },
});
