# Agent → app UI control (v1)

Status: contract only — shared wire types, pure validation and tests; no bridge, navigation or overlay wiring in this change.

## Purpose and trust boundary

A trusted, authenticated agent may ask Dash to **show** a point, a drawing or a highlight, or request navigation to a known app screen. This is presentation intent, not authorization to press buttons, type text, approve actions, follow URLs, execute JavaScript or inspect arbitrary screen contents. The bridge must authorize the sending session; the app must enforce the user's UI-control setting before acting. The parser alone never grants consent.

This is an additive **bridge → app** JSON text frame on the existing WebSocket:

~~~json
{
  "type": "ui_control",
  "schema": "dash.ui_control/v1",
  "command": {
    "type": "point",
    "id": "pointer-9",
    "target": { "testID": "trace_row-7" },
    "label": "Review this result",
    "ttlMs": 2000
  }
}
~~~

The command is a discriminated union by its inner "type" field. The outer "type" is always "ui_control". The parser accepts this envelope, returns a **new normalized command** or a human-readable error, and discards unknown properties. It rejects unknown command types, missing/unsupported schema versions, wrong field types and invalid limits. No legacy unversioned command is accepted. JSON frames from old peers that do not recognize "ui_control" remain unaffected; the bridge must not send it until the phone advertises support.

## Commands

| Inner type | Fields | Meaning |
| --- | --- | --- |
| "point" | required "id", "target", "ttlMs"; optional "label" | Point to a visible element by testID, or one position in the visible window. |
| "draw" | required "id", "strokes", "ttlMs"; optional "color" | Render one or more temporary polyline strokes, each with "points": [[x,y], ...]. |
| "navigate" | required "id", "route"; optional "conversationId" | Request navigation to an allowlisted in-app screen. A conversationId identifies a Chat thread only; it is not a URL or host path. |
| "highlight" | required "id", "testID", "ttlMs" | Temporarily emphasize one registered visible testID target. |
| "clear" | optional "id" | Dismiss an overlay with that command id, or all agent-owned overlays when omitted. Does not erase user-owned ink. |

A "point.target" is **either** {"testID":"visible-id"} **or** {"x":0.5,"y":0.5}. Mixing testID with x/y, or providing only one coordinate, is ambiguous and rejected. Unrecognized fields (including in nested targets, strokes and the envelope) are ignored, not executed or passed through.

Only the following exact-case navigation routes are allowed: "Lab", "Trace", "Orchestra", "Settings", "Bots" (the current AppRoute names from app/src/lib/app-route-link.ts), plus "Chat". No relative paths, HTTP links, deep-link parameters or arbitrary screens. "conversationId" is meaningful only for Chat; the receiver must never reuse it for another route. An absent conversationId navigates to the generic Chat screen.

## Coordinate space, drawing and visuals

Coordinates are **normalized, unitless [0,1]** values in the currently visible Dash window, never raw device pixels, display density or screen coordinates. (0,0) is the top-left; (1,1) is the bottom-right. The app maps them to the current rendered window after handling orientation, insets and native chrome. Offscreen, invisible or stale testIDs are not acted on. Strokes join successive normalized points in order; they do not trigger touches. No path data, SVG, HTML or image URLs are accepted.

Draw color is optional and restricted to "gold" or "cream" to match the existing OLED black, cream and gold palette. Overlays must not block touches and must respect reduced-motion preferences. Any interactive opt-in or dismiss control should be at least 44 dp.

## Limits — normative, enforced by shared/ui-control.ts

| Value | Rule |
| --- | --- |
| Envelope schema | exactly "dash.ui_control/v1" |
| Command kind | exactly point, draw, navigate, highlight or clear |
| Required command "id" | string, nonblank, 1–128 UTF-16 code units; required except on clear |
| Optional clear "id" | if present, same 1–128 nonblank limit |
| Optional navigate "conversationId" | if present, same 1–128 nonblank limit |
| Target "testID" / highlight "testID" | ASCII [A-Za-z0-9_-]{1,64}; no spaces, dots, slashes or selectors |
| Optional point "label" | string of 0–120 UTF-16 code units |
| Coordinates | finite numbers within [0,1], endpoints inclusive; never NaN, ±Infinity, strings or null |
| Each coordinate point | exactly a 2-element [x,y] tuple |
| Draw "strokes" | array of 1–16 strokes |
| Stroke "points" | array of 1–512 coordinate tuples per stroke |
| "ttlMs" for point, draw, highlight | required integer milliseconds, inclusive 250–30,000 |
| Optional "color" | exactly "gold" or "cream" |
| Navigate "route" | exactly Lab, Trace, Orchestra, Settings, Bots or Chat |

All optional fields, when supplied, must be valid; explicit null is not equivalent to absence. Every required field must exist and be valid, even if an older peer would ignore it. Validation rejects conflicting known target fields and never coerces values. The named "UI_CONTROL_LIMITS" and "UI_CONTROL_ROUTES" exports are the source for programmatic limit and allowlist tests; this table is the human-readable contract.

## Consent, visibility and expiration (integration obligations)

- **User-controlled opt-in:** Disable UI control by default until the user enables it. The user may turn it off immediately; disable drops queued commands and removes agent-owned overlays. Consent is separate from connection/session authentication and cannot be changed by these commands.
- **Visible provenance:** Every accepted command, including navigate and clear, must be shown in the app's agent-activity UI with its originating agent/session and a dismiss/disable action. Render only escaped/plain-text labels; never allow command text to create UI controls.
- **Auto-expiry:** Start the TTL clock when the app receives point/draw/highlight; automatically remove that overlay after its 250–30,000 ms TTL or sooner if cleared/disabled. A repeated command with the same id must not extend a stale command's lifetime through replay. For navigate/clear (which have no ttlMs), the activity indication expires after at most 30 seconds. All indicators can be dismissed sooner.
- **Foreground/visibility:** Only navigate when Dash is in a safe foreground navigation state and the user has opted in. An unknown/offscreen testID does nothing and reports a visible rejected/skipped status; no fallback to tapping or opening an external URL.
- **Replay/rate control:** Bridge and app must bind each command to an authenticated session, reject stale/out-of-order payloads, and cap command delivery rate and total active overlays. Those are integration controls, not properties of this stateless parser. Consent, dispatch, renderer expiration and feature negotiation are **not implemented** by this issue.

The command id is a stable correlation/overlay key; clear with an id targets that key, and clear without an id removes only agent-owned overlays. Neither form resets local user ink.

## Integration and versioning

Hermes owns the production union/dispatch changes in shared/protocol.ts, bridge/index.ts and app/src/net/bridge.ts plus the app store/screen presentation work. Add UiControlWireMessage to ServerMessage, route "ui_control" to parseUiControl, reconstruct the normalized envelope using UI_CONTROL_SCHEMA and send only through the authenticated, consent-gated bridge session. The app must map parsed commands to a visible presentation layer and enforce all lifecycle rules above. This PR deliberately does not change any Hermes-owned hot file.

Incompatible changes require a new schema value (for example "dash.ui_control/v2"), not an expanded interpretation of v1. Unknown schema versions fail closed. Unknown object properties may be ignored for forward-compatible additive extensions; unrecognized command kinds must always be rejected.

## Verification

Write-time acceptance is covered in shared/ui-control.test.ts: round-trips for all five command kinds, allowlisted routes, extra-field stripping, exclusive point-target shapes, finite coordinate edges, stroke and point array boundaries, TTL integer bounds, testID and id limits, palette and labels, and unknown schema/type rejection.

Hermes must execute:

~~~sh
bun test shared/ui-control.test.ts
bun test app/src bridge/src shared
bun run typecheck
bun run lint
bun scripts/mutate.ts
~~~

These commands are **not run** by the ChatGPT connector worker; no runtime, native overlay, device or consent evidence is claimed.
