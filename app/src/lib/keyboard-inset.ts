/** Space the open IME takes from the bottom of the window. KeyboardController reports it negative. */
export function keyboardInset(height: number): number {
  "worklet";
  return height < 0 ? -height : 0;
}
