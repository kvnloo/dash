# Deep links and stage links

Dash opens screens from links: `dash://connect` prefills Pair, `dash://stage` opens the artifact stage, `dash://trace` and `dash://lab` open those screens, and the app-route and chat links open Orchestra, Settings, Bots and a chat. On web the NavigationContainer maps the same paths; on native, handlers in `App.tsx` do the routing.

Status: UNCOVERED (no committed army test drives it)

## Sub-features

- `link-web-routes` browser URLs `<web>/connect`, `/stage`, `/trace`, `/lab` open Pair, ArtifactStage, Trace and Lab through NavigationContainer linking [UNCOVERED] (web reachable).
- `link-pair-prefill` `dash://connect?...` fills Pair with the address and code, never authorizing a connection [UNCOVERED] (native handler; web route opens Pair).
- `link-app-routes` `dash://lab|trace|orchestra|settings|bots` (and `exp://.../--/lab`) [UNCOVERED] (native only for orchestra, settings and bots).
- `link-stage` `dash://stage?...` opens ArtifactStage [UNCOVERED].
- `link-chat` `dash://chat/<id>` from a notice or notification opens that chat; malformed ids are rejected [UNCOVERED].

## How to get to it (user POV)

- Tap a Dash link in another app, a QR code, a notification or a Notices item.
- In the browser, open the web app at `/connect`, `/stage`, `/trace` or `/lab`.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- The web export is served at `ARMY_WEB`.

- **Web routes.** `await page.goto(web+'/lab')` after pairing, then expect `getByRole('heading',{name:'Component lab',exact:true})`. `web+'/trace'` shows the trace timeline entry. `web+'/connect'` shows `getByText('Pair with your laptop',{exact:true})` when unpaired.
- **Notice target.** The web-reachable app link is a Notices item whose url is `dash://approvals` (see `notices-screen.md`).
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/deep-links.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. Show the target screen after the URL load and that no connection was made from `connect` links alone.

## Gotchas

- On web only `connect`, `stage`, `trace` and `lab` are linked; `App.tsx` skips `stage-router`, `app-route-link` and chat-link handling when the platform is web. `dash://` links delivered by Android need a native army lane (never the owner's phone, adb or Maestro).
- A link can prefill Pair but cannot authorize anything; bootstrap credentials stay out of URLs.
- Route names are lowercase; unknown routes are ignored, not errors.
