package app.dash.stylus

/** A held button reports on many hover/touch frames; emit only state transitions. */
internal class ButtonEdges {
  private var down = false
  fun sample(pressed: Boolean): Boolean? {
    if (pressed == down) return null
    down = pressed
    return pressed
  }
}
