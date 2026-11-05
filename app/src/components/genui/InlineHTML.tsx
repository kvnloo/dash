import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Text, View } from "react-native";
import type { LiveArtifact } from "../../../../shared/live";
import type { RootStackParamList } from "../../navigation";
import { sandboxHTML } from "../../lib/genui";
import { colors, type } from "../../theme";
import { LiveArtifactFrame } from "../LiveArtifactFrame";
import { PressScale } from "../PressScale";
const ignore = () => {};
export function InlineHTML({ source, artifact }: { source?: string; artifact?: LiveArtifact }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const html = source ?? artifact?.html ?? "";
  return <View style={{ gap: 6, marginVertical: 8 }}>
    <LiveArtifactFrame html={sandboxHTML(html)} version={artifact?.version ?? 1} height={260} onIntent={ignore} staticOnly />
    <PressScale accessibilityRole="button" accessibilityLabel="Open HTML in stage" onPress={() => nav.navigate("ArtifactStage", { html, title: artifact?.title ?? "HTML preview · unverified" })} style={{ minHeight: 44, justifyContent: "center" }}>
      <Text style={{ ...type.small, color: colors.gold }}>Open in stage ↗ · sandboxed preview</Text>
    </PressScale>
  </View>;
}
