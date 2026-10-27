# Inline media and artifact stage

Images in a reply show inline and open a full view with a close control. HTML the agent returns is shown as a small card with `Open HTML in stage`, which opens the full-screen ArtifactStage screen (title `HTML preview · unverified`) that renders the page in a live artifact frame.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.14 inline image opens full view and closes; inline HTML opens ArtifactStage"

## Sub-features

- `media-image-open` tap the inline image to open full view [UNCOVERED]
- `media-image-close` `Close image` returns to the transcript [UNCOVERED]
- `media-html-stage` `Open HTML in stage` opens ArtifactStage [UNCOVERED]
- `media-live-frame` the stage renders HTML in `LiveArtifactFrame` [UNCOVERED]

## How to get to it (user POV)

- Read a reply that contains an image (markdown image, or an image file path in the reply) and tap it.
- Read a reply with an html code fence and tap `Open HTML in stage`.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent cannot emit images or html fences. The draft uses an `ARMY_R07_MEDIA` scenario from an uncommitted fixture-agent extension. The image URL must be served locally or the external host trapped with a `page.context().route` abort so the run does not touch the network.

- **Send.** `await openChat(page,bridge)`; `await send(page,'ARMY_HANG ARMY_R07_MEDIA media journey')`; wait for `ARMY_MEDIA_DONE`.
- **Open image.** `await page.getByRole('button',{name:'Open image: ARMY chart',exact:true}).click()`. `page.getByRole('button',{name:'Close image',exact:true})` is visible and contains `Close · ARMY chart`.
- **Close.** Click `Close image`; its count is 0.
- **Open stage.** `await page.getByRole('button',{name:'Open HTML in stage',exact:true}).click()`. `page.getByText('HTML preview · unverified',{exact:true}).first()` is visible and `composer(page)` count is 0 (full-screen screen replaced the chat).
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/inline-media.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png` of the stage screen with the page content; `video.webm` covering open and close of the image; `trace.zip`; `bridge.log`.

## Gotchas

- The accessible name is `Open image: <alt>`; markdown images without alt are labelled `Image`.
- An image that fails to load shows `Image could not be loaded` in place of the button; a blocked host looks the same, so serve the image locally when the image itself is the test.
- The stage title is `HTML preview · unverified` unless the artifact carries its own title.
- HTML fences over 200000 characters fall back to a plain code block (no stage button).
- On web `LiveArtifactFrame` is a sandboxed frame; assert content through `page.frameLocator`, not `page.getByText`.
