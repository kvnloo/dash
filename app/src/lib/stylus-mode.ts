/**
 * Annotate/Normal is a deliberate mode, never inferred from S Pen contact.
 * Preserve the button latch across changes made through the UI pill.
 */
export interface StylusModeState {
  active: boolean;
  buttonDown: boolean;
}

/** Only the rising edge toggles. Release and repeated down events do not. */
export function penButton(state: StylusModeState, pressed: boolean): StylusModeState {
  if (state.buttonDown === pressed) return state;
  return { active: pressed ? !state.active : state.active, buttonDown: pressed };
}

export interface StylusButtonSource {
  addListener(event: "button", listener: (payload: unknown) => void): { remove(): void };
}

/**
 * Guard the optional native boundary. Malformed native events do not change mode.
 * Cleanup resets a held edge so the next subscription can accept a fresh press.
 */
export function subscribeStylusButton(
  source: StylusButtonSource | null | undefined,
  onPressed: (pressed: boolean) => void,
): () => void {
  if (!source) return () => {};
  let listening = true;
  let subscription: { remove(): void };
  try {
    subscription = source.addListener("button", payload => {
      if (!listening || typeof payload !== "object" || payload === null ||
        !("pressed" in payload) || typeof payload.pressed !== "boolean") return;
      onPressed(payload.pressed);
    });
  } catch {
    // Missing or partially initialized native modules must not break manual mode.
    return () => {};
  }
  return () => {
    if (!listening) return;
    listening = false;
    try { subscription.remove(); } catch { /* Native may already be torn down. */ }
    onPressed(false);
  };
}
