# Android share into Dash (share inbox)

Sharing text, a link or files from another Android app into Dash stages them as a draft for a chat. The share sheet entry, file copy into the app and the staging prompt exist only in the installed Android build.

Status: UNCOVERED (no committed army test drives it)

## Sub-features

- `share-text-link` shared text or link is staged as a draft [UNCOVERED] (native only).
- `share-files` shared files are validated (size, count, path) and attached [UNCOVERED] (native only).
- `share-web-note` web and Expo Go show the "require the installed Dash build" text instead (see `notifications.md`) [UNCOVERED].

## How to get to it (user POV)

- In another Android app, Share, then choose Dash. Dash opens with the shared content ready to send.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Paired via `pair(page,bridge)`.

- **Web-reachable part.** Open Settings (`getByRole('button',{name:'Open settings'}).first()`) and read the Notifications text `Notifications and incoming Android shares require the installed Dash build. Expo Go and web remain usable without them.`; no share control exists.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/android-share.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. They show only the web note; native acceptance is not proven.

## Gotchas

- The share sheet, file copy and staging prompt cannot be exercised on web. A native army lane is needed. Never drive the owner's phone, adb or Maestro.
- Share validation rules (id format, 50 MB total, path traversal rejection) live in `app/src/lib/incoming-share.ts` and belong to unit tests; a unit test does not count as feature coverage.
- Do not mark this feature verified from the web note alone.
