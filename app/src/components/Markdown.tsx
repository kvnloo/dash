import { memo } from "react";
import { StyleSheet, Text } from "react-native";
import { colors, type } from "../theme";

/** Plain-text renderer — keeps the bundle RN-safe for Expo Go. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <Text selectable style={styles.body}>
      {text}
    </Text>
  );
});

const styles = StyleSheet.create({
  body: { color: colors.text, ...type.body },
});
