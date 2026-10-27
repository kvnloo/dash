# Surface journeys (S22 against an isolated candidate Metro port, never the S25)
Run under /tmp/s22-ui.lock with `uv run -q --with uiautomator2 python <script> <port>`.

| Surface (paths) | Journey | Passes when |
|---|---|---|
| every candidate | `lazy_chunks.sh <port>` | exit 0, all async chunk URLs 200 |
| annotate (app/src/components/annotate, app/src/store/annotate.ts, app/src/lib/annotate) | `ink_journey.py <port>` | no "Ink couldn't load", Exit visible, Exit closes the tray and frame |
| voice (app/src/lib/voice*, app/src/lib/continuous-voice*, app/src/components/ContinuousVoiceRoot.tsx, app/src/screens/VoiceScreen.tsx, bridge voice routes) | `voice_journey.py <port>` | V1 start + Dash-owned status, V2 in-Dash End in every state (incl. error), V3 idle + mic released after End, V4 Dash stays resumed, V5 no chunk/resolve errors. Unpaired/no-credential error path is error-handling evidence only, not mic/duplex proof. Baseline 1e1f42f on :8213 = FAIL V2 (error pill has Retry only). The floating gear on the S22 is the expo dev-client dev-menu button, not app UI. |
| chat list / workspace render | `$TMPDIR/repro8212.py <port>` pattern | rendered at 15/35/60 s, no logcat errors |
