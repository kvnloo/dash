import { useState } from "react";
import { Text, View } from "react-native";
import { botFaceIdentity, type BotFaceState } from "../lib/moodie-identity";
import { colors, fonts, space } from "../theme";
import { BotFace } from "./BotFace";
import { PressScale } from "./PressScale";

const STATES: readonly BotFaceState[] = ["idle", "thinking", "working", "done", "error", "waiting-approval"];
const PROFILES = ["default", "clean", "chiefstaff", "intake"];

/** Explicit component samples, never presented as live roster status. */
export function BotFaceLab() {
  const [state, setState] = useState<BotFaceState>("idle");
  return <View testID="bot-face-lab" style={{ gap: space.md }}>
    <Text style={{ color: colors.textMuted, fontFamily: fonts.mono, fontSize: 11 }}>Moodie + bloub · profile samples · not live</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {STATES.map(value => <PressScale key={value} onPress={() => setState(value)} accessibilityRole="button" accessibilityLabel={`Face state ${value}`} accessibilityState={{ selected: state === value }} style={{ padding: space.sm, borderRadius: space.sm, backgroundColor: state === value ? colors.bubble : colors.surface }}>
        <Text style={{ color: state === value ? colors.text : colors.textMuted, fontSize: 12 }}>{value}</Text>
      </PressScale>)}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
      {PROFILES.map(profile => <View key={profile} style={{ width: 68, alignItems: "center", gap: space.sm }}>
        <BotFace identity={botFaceIdentity(profile)} state={state} size={64} />
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>{profile}</Text>
      </View>)}
    </View>
  </View>;
}
