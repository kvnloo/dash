# Chat window

Opening a chat from the Chats list (middle page) presents the existing `Chat` route as a window over
the still-mounted workspace (`params.window`, `presentation: "transparentModal"`). It is the same
conversation, session and composer; only the presentation differs. Other entry points keep the page.

- Top: `AppNav` collapses into `WindowPill` (tap expands the nav in place). Geometry comes from
  `pillGeometry` in `app/src/lib/chat-window.ts`. Android uses the existing optional
  `DashDisplayCutout` reader (`app/modules/dash-cutout`):
  `decorView.rootWindowInsets.displayCutout.boundingRects` (API 28+), converted from px to DIP
  once using display density. Both pill renderers centre on that rect and reserve a rounded
  rectangular hole using its width AND height plus 4 DIP clearance, not a width-derived circle.
  The bounding rect is an exclusion region, not the lens's optical outline. Readings for a stale
  window size are ignored; attachment/rotation reads retry briefly for updated window insets.
  Expo SDK 57 / safe-area-context 5.7 expose edge insets and the provider frame, not bounding rects.
  There is no JS-only or config-plugin-free Android API call to recover an exact lens rect in
  Expo Go. Exact geometry needs this existing Kotlin Expo module compiled into a custom app
  (Expo autolinks it from `app/modules`; no config plugin or new dependency). Expo Go, older
  binaries without that module, and devices without a top cutout retain a capsule centred on
  the window width BELOW the top safe inset. Insets cannot establish lens width or centre;
  the fallback deliberately does not invent a camera hole or model-specific S25/S22 constants.
- Bottom: the dock becomes one attached surface: Options menu trigger (`ComposerActionMenu`), the
  identity badge (host · harness · profile · session8 · model; model is `model unknown` until the host
  reports one), whose tap opens a compact identity sheet, and the close X on the handedness side.
  The sheet is flat rows, never a nested tree: one breadcrumb line (host › profile › harness), the
  session (title, middle-truncated id, copy button; a parent or continuation is indented one level),
  the model, and a provenance footer inside the sheet (lineage, where the model reading came from,
  and why the model cannot be changed here).
- Close (X or Android Back after menu → tree → nav) only pops the window; it never cancels a turn or
  touches voice. Drafts persist per conversation in `store/composer-drafts.ts` (shared with the interaction repair).
- Motion: transform/opacity only, `snappy` open and `fade` close, reduced motion honoured.

Army coverage: `e2e/mbp-army/cutout-pill.spec.ts` simulates only the hardware reading;
it pairs to the isolated real bridge and asserts rendered pill and hole bounds. Not run in this
change; no army receipt or native S25 Ultra/S22+ acceptance is claimed.
