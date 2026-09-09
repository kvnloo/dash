import { memo } from "react";
import { StyleSheet, Text } from "react-native";
import { colors, type } from "../theme";
import { GlassSurface } from "./GlassSurface";

/** Circle badge with the harness initial — matches preview.html conversation rows. */
export const HarnessAvatar = memo(function HarnessAvatar({
  name,
  size = 48,
}: {
  name: string;
  size?: number;
}) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <GlassSurface variant="chip" blur={false} borderRadius={size / 2} style={[styles.avatar, { width: size, height: size }]}>
      <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{letter}</Text>
    </GlassSurface>
  );
});

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  letter: { color: colors.text, ...type.heading, fontWeight: "600" },
});
