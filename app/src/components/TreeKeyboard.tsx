import type { ReactNode } from "react";
import { View } from "react-native";

export interface TreeKeyboardProps {
  label: string;
  inline?: boolean;
  children: ReactNode;
  onKey(key: string, id: string): string | undefined | void;
}
export function TreeKeyboard({ children, label, inline }: TreeKeyboardProps) {
  return <View style={{ flex: inline ? undefined : 1 }} accessibilityLabel={label}>{children}</View>;
}
