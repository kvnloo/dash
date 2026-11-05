import type { ReactNode } from "react";
import type { SharedValue } from "react-native-reanimated";

/** Native arbitration belongs to Gesture Handler; no JS touch-move listener on the phone. */
export function TileTouch({ children }: { holding: SharedValue<boolean>; children: ReactNode; onOpen(): void; onPrimary(): void; onSecondary(): void }) {
  return <>{children}</>;
}
