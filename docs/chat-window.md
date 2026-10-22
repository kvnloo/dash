# Chat window

Opening a chat from the Chats list (middle page) presents the existing `Chat` route as a window over
the still-mounted workspace (`params.window`, `presentation: "transparentModal"`). It is the same
conversation, session and composer; only the presentation differs. Other entry points keep the page.

- Top: `AppNav` collapses into `WindowPill` (tap expands the nav in place). Geometry comes from
  `pillGeometry` in `app/src/lib/chat-window.ts`. JS has no display cut-out rect, so the pill uses the
  safe-area fallback; a native DisplayCutout reader can pass its rect as `cutout` without UI changes.
- Bottom: the dock becomes one attached surface: Options menu trigger (`ComposerActionMenu`), the
  identity badge (host · harness · profile · session8 · model; model is `model unknown` until the host
  reports one) with the shared `Tree`, and the close X on the handedness side.
- Close (X or Android Back after menu → tree → nav) only pops the window; it never cancels a turn or
  touches voice. Drafts persist per conversation in `store/composer-draft.ts`.
- Motion: transform/opacity only, `snappy` open and `fade` close, reduced motion honoured.

Proof: `fleet-build --node mbp ... -- bash scripts/fleet-chat-window.sh` (rendered Expo web journey in
`scripts/chat-window-proof.mjs`). Web proof is not device acceptance.
