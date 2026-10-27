# Annotation engines (WP1 + WP2)

Web defaults to `tldraw`; native defaults to `skia`. For a fresh web session,
`?annotateEngine=skia` or `?annotateEngine=tldraw` overrides the default.
Native builds can opt in with `EXPO_PUBLIC_ANNOTATE_ENGINE=tldraw`.
This is a development-only tldraw integration, tested on loopback; no license
key is included or requested. Production licensing and native qualification
remain separate gates. Native has not been qualified and must stay on Skia.

The Expo DOM editor mounts while annotation is closed. Opening it enables input
without recreating the editor. Ready-to-draw and cold mount timings are logged
with the `[annotate-tldraw]` prefix. Dash keeps its existing toolbar; the DOM
imperative handle supports undo, redo, clear, and bounded PNG export. The
watermark and license behavior are unchanged.

`tldraw` is pinned to **5.5.2**. `tldraw-assets/bundled.json` contains that
version's 16 font files, icon sprite, and English translation from the published
`@tldraw/assets` package. They are embedded data URLs, not CDN fallbacks, so the
same asset map works in the native DOM bundle without an HTTP asset server.
The package license is retained alongside the bundle. Keep the vendored assets
and SDK version in sync when upgrading. Non-English UI is not exposed.

The adapter maps draw/highlight/arrow/rectangle/ellipse shapes to Dash strokes.
Pointer samples supply epoch times and pressure (tldraw's compressed paths have
no timestamps); they are stored in shape-local coordinates. The editor's shape
page transform, **not the screen camera**, is applied before normalization by
the captured screen dimensions. IDs survive undo/redo. Existing `commitStroke`,
`annotationDoc`, transcript markers, alignment, upload, and sink sending remain
the contract boundary.

WP3's ink-layer compositing, WP4's S Pen qualification/double-tap, WP5's DeX
camera controls/lasso, and later native rollout are not included. Sending still
uses the existing Skia compositor, intentionally; exporting from the DOM handle
is not yet the send compositor.

Army journeys: `e2e/mbp-army/annotate-tldraw.spec.ts`. They drive Options →
Annotate, draw real input, inspect visible SVG ink, exercise history, record
network/readiness evidence, and compare the JSON uploaded to the isolated
bridge by both engines. The generated navigation screen UUID is the sole field
canonicalized when comparing otherwise identical synthetic sessions.
