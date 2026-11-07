import { Keyboard, Platform } from "react-native";

/**
 * Resolves when the IME reports hidden. React Native sends keyboardDidHide as soon as the root insets
 * change, which is the START of the hide animation: the dock is still travelling down afterwards, so a
 * popup anchored to it must still wait for it to stop (see settledAnchor in lib/anchor).
 */
export function dismissKeyboard(): Promise<void> {
  if (Platform.OS === "web" || !Keyboard.isVisible()) {
    Keyboard.dismiss();
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timeout); listener.remove(); resolve(); };
    const listener = Keyboard.addListener("keyboardDidHide", finish);
    // Some Android IMEs omit didHide. Do not leave Attach permanently unresponsive.
    const timeout = setTimeout(finish, 600);
    Keyboard.dismiss();
  });
}