# Inline media and artifact stage

Status: PARTIALLY COVERED — `e2e/mbp-army/prototype-stage.spec.ts` covers both prototype routes; image interactions are not covered here.

- `media-image-open` and `media-image-close` [UNCOVERED]
- `media-html-stage` and `media-live-frame` [COVERED]: inline chat preview stays passive; Open interactive prototype enables self-contained controls in a sandbox.
- `hosted-prototype-link` [COVERED]: Open review in stage loads a tokenized link at its original path, keeps its fragment, and passes `channel=dash`.

The hosted journey starts a local fixture HTTP server and verifies the in-frame control and Dash channel request. The generated journey streams HTML over fixture ACP, clicks the inline control to verify that it stays inert, then opens the interactive stage and clicks the same control to verify the state change. Assert inside the frames with `page.frameLocator`.

Drive: `army-stack.sh drive <run> 1 e2e/mbp-army/prototype-stage.spec.ts`. Android WebView behavior is not proven by the web army.

### Hosted draw-and-speak reviews (DA-067)

The hosted prototype journey checks that a cross-origin review inside Dash can
open a synthetic Chromium microphone stream. It does not check transcription,
drawn-region association, old/new selection, or the HITL submission. Those
belong to the separately served artifact-stage viewer and review backend; the
Dash link and iframe alone do not implement them.

For a web voice review, serve both Dash and the stage over HTTPS (a loopback
fixture is acceptable for local testing). Plain HTTP on a tailnet address is not
a secure context for microphone capture, even if the review link opens. Keep
the per-review token in the URL fragment; do not substitute a Dash credential.
