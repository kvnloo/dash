import { createContext } from "react";
import type { SharedValue } from "react-native-reanimated";

/** Prevent a web responder click from opening a row at the end of a page swipe.
 * Reset on the very next touch, not on animation completion.
 */
export const PagerGestureContext = createContext<SharedValue<boolean> | null>(null);
