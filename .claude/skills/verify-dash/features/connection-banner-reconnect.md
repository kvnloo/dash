# Connection banner and reconnect

When the bridge goes away, a banner appears over Main ("Bridge unreachable" or "Connecting to bridge", with "Queued drafts kept") and a Retry button. Send is disabled while offline, the typed draft stays in the composer, and when the bridge returns the app reconnects and Send works again.

Status: COVERED by `e2e/mbp-army/army.spec.ts` › "bridge process death disables Send and restart reconnects"
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-00-01-navigation-shell-top-nav-and-bridge-p.spec.ts` › "killed bridge shows the banner; Retry reconnects when the bridge is back"

## Sub-features

- `offline-send-disabled` Send is disabled and the draft survives while offline. [covered: "bridge process death disables Send and restart reconnects"]
- `offline-banner-text` offline or connecting copy is visible. [covered: "bridge process death disables Send and restart reconnects"] (regex text match only)
- `reconnect-auto` restarting the bridge re-enables Send and the turn streams. [covered: "bridge process death disables Send and restart reconnects"]
- `banner-retry` the Retry button reconnects and the banner disappears. [UNCOVERED]

## How to get to it (user POV)

- Lose the connection to the bridge (it stops, or the network drops) while the app is open.
- Tap Retry on the banner, or wait for the automatic backoff.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- `openChat(page, bridge)` for an open chat window; the fixture bridge can be stopped and restarted with `bridge.stop()` and `bridge.start()` on the same port.

- **Type a draft.** `await composer(page).fill('draft while offline')`.
- **Kill the bridge.** `await bridge.stop()`. `getByRole('button',{name:'Send',exact:true})` becomes disabled within 15 s, and `getByText(/tap to retry|Connecting to bridge|Offline|Disconnected/i)` is visible. The composer still has the draft value.
- **Banner details (not driven).** `getByTestId('connection-banner')` is visible, `connection-banner-copy` has an aria-label starting `Bridge unreachable. ` and ending `Queued drafts kept`, and `getByTestId('connection-retry')` has label `Retry bridge connection`.
- **Restart.** `await bridge.start()`. Send is enabled within 30 s. Click it; `ARMY_REPLY: draft while offline` appears.
- **Run.** `.claude/skills/verify-dash/scripts/army-stack.sh drive <run> 1 e2e/mbp-army/army.spec.ts -g "bridge process death disables Send and restart reconnects"`
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The video must show the disabled Send, then the enabled Send and the reply. `bridge.log` must show two bridge startups on the same port.

## Gotchas

- The committed test matches banner copy with a loose regex, so it does not prove the banner testIDs or Retry. Report Retry as UNCOVERED.
- Automatic backoff grows to about 8 s. To prove Retry rather than auto-reconnect, wait for the `Bridge unreachable` state and about 9 s before `bridge.start()`.
- `bridge.start()` reuses the previous port. A different port would never reconnect.
- The `ephemeral ACP regression` describe uses `persistSession:false`; do not mix it in.
