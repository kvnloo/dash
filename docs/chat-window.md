# Chat window

Opening a chat from the Chats list (middle page) presents the existing `Chat` route as a window over
the still-mounted workspace (`params.window`, `presentation: "transparentModal"`). It is the same
conversation, session and composer; only the presentation differs. Other entry points keep the page.

- Top: `AppNav` collapses into `WindowPill` (tap expands the nav in place). Geometry comes from
  `pillGeometry` in `app/src/lib/chat-window.ts`. JS has no display cut-out rect, so the pill uses the
  safe-area fallback; a native DisplayCutout reader can pass its rect as `cutout` without UI changes.
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

Proof: `fleet-build --node mbp ... -- bash scripts/fleet-chat-window.sh` (rendered Expo web journey in
`scripts/chat-window-proof.mjs`). Web proof is not device acceptance.
