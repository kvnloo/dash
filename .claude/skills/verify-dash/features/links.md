# Links in replies

Markdown links in a reply are tappable and open only when they are http(s); other schemes such as `mailto:` do nothing. RC3 intends bare https URLs and `path:line` text outside code to be tappable too, and plain inside code, but that linkifier is not wired in at this checkout.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-06-07-transcript-rendering-links-tool-rows-.spec.ts` › "07.03 markdown [text](https://) link opens the URL; a non-http link does not open"; "07.04 RC3 #419/#386 bare https URL and file:line outside code are tappable links; inside code they stay plain"

## Sub-features

- `link-md-http` `[text](https://...)` renders as a link and opens the URL [UNCOVERED]
- `link-md-other` `[text](mailto:...)` renders but opens nothing [UNCOVERED]
- `link-bare` bare https URL and `file:line` outside code are links, plain inside code [UNCOVERED] (expected FAIL at this checkout: not mounted)

## How to get to it (user POV)

- Read a reply containing a link and tap it.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The committed fixture agent cannot emit links; the draft uses an `ARMY_R07_LINKS` scenario from an uncommitted fixture-agent extension.
- Navigations to the link hosts must be trapped so nothing leaves the machine: the draft's `egress(page)` aborts and records requests to `example.com`, `example.invalid`, `github.com` via `page.context().route`, and collects popups.

- **Open a chat and send.** `await openChat(page,bridge)`, then `await send(page,'ARMY_HANG ARMY_R07_LINKS links journey')`. Wait for `ARMY_LINKS_DONE`.
- **http link.** `await page.getByRole('link',{name:'ARMY web link',exact:true}).click()`. The egress guard records a request to the link URL.
- **Non-http link.** `await page.getByRole('link',{name:'ARMY mail link',exact:true}).click()`. No `mailto:` popup, no new request, composer still visible.
- **Bare URL.** `page.getByRole('link',{name:'https://example.com/army-bare',exact:true})` should be visible and open the URL. Expected FAIL at 2c948dc: `linkify-paths.ts` and `link-target.ts` have no importer, bare text stays plain.
- **Inside code.** `page.getByRole('link',{name:/in-code/})` count is 0.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/links.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm` showing the tap, `trace.zip` with the recorded request, `bridge.log`; the guard's request list must contain the https URL and no `mailto:`.

## Gotchas

- Only the Markdown link renderer exists: `/^https?:\/\//i` opens, everything else is inert, and a link to an image URL renders an inline image instead of a link.
- Bare URL and `file:line` linkifying is unwired here; report 07.04 as failing, do not weaken it.
- A real tap on a link tries to leave the page. Without the egress route the test navigates away and the run is invalid.
- `getByRole('link')` works because the Text has `accessibilityRole="link"`; the match is on the rendered text.
