# Same-chat agent surface

This is a JS-only control surface over Dash's existing authenticated bridge WebSocket. It is separate from libfx `LiveSurface`: that component forwards ephemeral HTML inside a chat; it cannot navigate or annotate the app chrome. The debug navigation reference is reused internally, but no debug controller, arbitrary JavaScript, ADB endpoint, message sending, approval decisions or model changes are exposed.

## Consent and attachment

In the **existing attached chat**, use the visible **Guide** switch next to **Annotate**. Guide starts off. The attached chat must already have a host, profile and native session. Enabling it grants only this app-run client and this exact host/profile/session/local-chat tuple. Switching chat/session, backgrounding the app, disabling control, disconnecting, token revocation, or grant expiry invalidates the old control capability. No chat is created, selected, reset or resumed by this API.

The authenticated socket registers state. The bridge creates a random 256-bit, ten-minute `dash:surface` capability in an owner-private (0700) directory, with a 0600 grant file:

```
${DASH_CREDENTIAL_DIR:-$HOME/.dash}/agent-surface/dash-<client>-<nonce>.json
```

The file is a local agent handoff, not a vault token. Treat it as a secret; never paste its contents into chat or commit it. It records the authenticated socket's principal for exact-device selection and only authorizes the surface endpoint for that connected client. A broad bridge execution token is **not** accepted at this endpoint. Every operation is tied to the registered socket principal and exact target. A second socket cannot claim an existing client ID or forge its receipt. Legacy authenticated sockets and z0bridge identity-authenticated sockets share the same per-socket isolation; identity expiry/revocation closes the existing authenticated socket and removes its surface grant.

## Agent command

After the parent promotes the bridge and app together and the owner enables Guide, select the grant for the **exact current device/session**, not the first or newest arbitrary client. The grant's `target` metadata can be inspected locally without printing `capability`. The CLI requires both identifiers explicitly:

```sh
node scripts/agent-surface.mjs \
  --grant "$PRIVATE_GRANT_FILE" --client "$EXACT_CLIENT" --session "$EXACT_SESSION" state

# Highlights existing Options and Annotate, waits 1.5s, opens annotation in-place.
node scripts/agent-surface.mjs \
  --grant "$PRIVATE_GRANT_FILE" --client "$EXACT_CLIENT" --session "$EXACT_SESSION" demo

# Optional app navigation and back to the retained chat/composer.
node scripts/agent-surface.mjs --grant "$PRIVATE_GRANT_FILE" --client "$EXACT_CLIENT" --session "$EXACT_SESSION" navigate trace
node scripts/agent-surface.mjs --grant "$PRIVATE_GRANT_FILE" --client "$EXACT_CLIENT" --session "$EXACT_SESSION" navigate chat
```

The CLI obtains a fresh state and waits for a render receipt for each command. It refuses to demonstrate on a different foreground screen. `navigate chat` only returns to an already mounted Chat screen: it never creates one. Other destinations are `bots`, `chats`, `orchestra`, `settings`, `trace`, `lab`, `back`. Navigation pushes screens above the retained Chat; it does not reset the navigator or mutate the active conversation, composer, draft or queue. API navigation does not accept route params. Pairing, Voice, Approvals, ArtifactStage, model selection, destructive actions and sending are excluded.

## HTTP contract

- `GET /agent-surface/<exact-client>/state` sends a snapshot command over the registered socket and waits for its rendered/readback receipt.
- `POST /agent-surface/<exact-client>/command` requires JSON and `Authorization: Bearer <scoped capability>`. No capability in a query string.
- Responses are `Cache-Control: no-store`. All requests retain the bridge's existing host/origin restrictions. This is not another listening server.

Example payload, using values from the fresh snapshot (not invented coordinates):

```json
{
  "id": "unique-command-id",
  "target": {"client":"exact-client","host":"exact-host","profile":"exact-profile","session":"exact-session","chat":"exact-chat"},
  "route": "chat",
  "generation": 42,
  "expiresAt": 1234567890000,
  "op": "draw",
  "ttlMs": 8000,
  "primitives": [
    {"kind":"box","anchor":"chat.options"},
    {"kind":"arrow","anchor":"chat.annotate"}
  ]
}
```

Operations: `snapshot`, `navigate` (`destination`), `annotation.open`, `draw`, `clear`, `dismiss`. Clear/dismiss only remove **agent** graphics, never the user's S Pen drawing or annotation tray. Opening annotation preserves existing user strokes and never sends them. An agent graphic can be an `arrow`, `box`, `circle` or `label` with a semantic `anchor`, or a normalized `{x,y,width,height}` rect, never both. Optional text is at most 120 characters. Current anchors are `chat.options`, `chat.annotate`, `chat.guide`, `guide.dismiss`, `guide.disable`; only foreground controls appear.

Snapshots include current semantic route, exact attachment, viewport, safe/keyboard insets, monotonically changing layout generation, anchor rectangles, annotation-open state and ten-second expiry. Main pager state is reported from its actual selected page. Rotation, keyboard changes, route changes and anchor layout changes invalidate the generation and remove old agent graphics. Normalized geometry is only accepted against the matching generation; all graphics are clipped to usable viewport/insets and fully occluded targets are rejected.

Limits: 16 KiB command body, 16 primitives, 500–15,000 ms graphic TTL, command expiry at most 15 seconds ahead, one in-flight operation per client, 128 bounded idempotency receipts, 32 connected grants, navigation depth 12. Duplicate IDs return their original receipt without reapplying; conflicting payloads reject. A missing acknowledgement times out as rejected/unknown application state, not success; retrying the ID cannot dispatch again. Wrong client/host/profile/session/chat, stale route/generation, expired snapshots/commands/grants, hidden/unknown anchors, unknown fields/operations/routes and unapproved capabilities fail closed.

`status: rendered` is sent only after React layout-effect commit and frame fences, with actual route/annotation/graphic readback. This is UI application/commit acknowledgement, not a hardware-compositor screenshot receipt. Real-device pixels remain a separate owner-authorized acceptance gate.

## Deployment and qualification

No APK or native dependency change is required. The existing shared bridge does **not** already route these commands; its new broker and wiring must be reviewed/promoted with the app. An app-only Fast Refresh makes the local controls available but does not deliver agent transport on the old bridge. Workers must not restart it.

Guide mode reserves a 44-point strip for Dismiss/Control off rather than placing interactive buttons over the navigation pager. The expressive layer remains pointer-transparent. Web bootstrap loads CanvasKit before importing App because Skia captures the global WASM API at module evaluation; merely loading it before the lazy InkCanvas import is too late when App already imported ShimmerText. Native bootstrap keeps its existing static App registration and requires no WASM or native build change.

Run all CPU work through MBP admission, never on groot:

```sh
fleet-build --node mbp --cpus 2 --mem 4G --wait 1800 --timeout 1800 \
  --fetch .surface-receipts --out "$RECEIPTS" -- bash scripts/fleet-agent-surface.sh
```

This runs project typechecks, surface safety tests, the full unit suite, mutation, Android JS export and the real mounted Expo Web app against an isolated **real bridge entry point**, with disposable credentials and fixture chat data. The Web journey highlights controls, uses the actual agent CLI, navigates existing screens and returns, preserves the unsent composer and held queue, draws user ink by a real gesture, proves agent clear/TTL do not clear that ink, disables control and checks 401 readback. It does not create a model session, send a real model turn, touch the daily phone, install anything or alter shared services. Web proof does not establish native Fast Refresh, Android IME or phone render acceptance.
