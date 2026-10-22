import { Keyboard, Platform } from "react-native";

/** Let the translated dock settle before measuring an anchored popup. */
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