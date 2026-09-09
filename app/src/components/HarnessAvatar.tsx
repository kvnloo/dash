import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, type } from "../theme";

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
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{letter}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  letter: { color: colors.text, ...type.heading, fontWeight: "600" },
});
