# z0live voice broker HTTP contract (client-inferred)

**Status:** Inferred from the Dash clients in `app/src/lib/continuous-voice.ts` and `app/src/components/ContinuousVoiceRoot.tsx`; **the broker source is not in this repository**. This is a client-side interoperability contract, not a claim that the deployed broker implements every route.

## Authentication and trust

- Dash obtains a short-lived z0bridge token for **audience `z0live`** and **scope `z0live:voice`**, independently of its bridge `dash:chat` token. Each broker request sends `Authorization: Bearer <token>`.
- The bridge's authenticated `POST /voice/bootstrap` confirms the exact attached Hermes profile/session and supplies the broker origin (as amended by TURBO-C02). No broker bearer or OpenAI provider token crosses that endpoint.
- The app accepts only a canonical HTTPS `.ts.net` broker origin with an explicit port. An explicit, loopback-only web-army build can use an HTTP `127.0.0.1` origin; that exception is **not** an authorization or deployment path for native users. The bridge also requires `DASH_ARMY_VOICE_WEB=1`, a loopback `DASH_Z0LIVE_BROKER`, an allowed loopback browser `Origin`, and a verified Dash identity token to authorize web-army `/voice/bootstrap`.
- Broker requests use JSON with `Content-Type: application/json`, except provider SDP signaling. The short-lived provider `value` returned at session mint goes only to the fixed provider call signaling endpoint, not to other broker calls.

## Endpoints used by the client

| Method and route | Request | Response / observed client behavior |
| --- | --- | --- |
| `POST /v1/realtime/session` | `{"client":"dash","transports":["realtime"],"model":"gpt-realtime-2.1","fallback_model":"gpt-realtime","context":{"app":"app.dash.mobile","hermes_target":{"profile":"<canonical Hermes profile>","session":"<attached session id>"}},"tools":[]}` | `{"session_id":"<id>","value":"<short-lived provider secret>","transport":"realtime"}`. Client requires these types and the exact `realtime` transport. |
| `GET /v1/inbox?after=<cursor>` | No body, nonnegative integer cursor | `{"messages":[...],"after":<integer>,"has_more":<boolean>}`. Each message used for spoken output has `session_id`, `params` (object), and `say` (nonempty string). An `action` message is observed as unsupported; `params.silent === true` and progress/partial sources are not spoken. |
| `POST /v1/events` | JSON array of `{"session_id":"<id>","ts":<Unix seconds>,"type":"floor"|"user_transcript"|"assistant_transcript"|"tool_result"|"barge_in", "text":"...", "data":{"event_id":"..."}}` | JSON acknowledgment; the client currently doesn't inspect its shape. |
| `POST /v1/tools/ask_z0` | `{"session_id":"<id>","call_id":"<durable realtime item id>","arguments":{"question":"<user transcript>"}}` | JSON with `ok: true` is required for acceptance; final speech arrives later through the inbox, not directly in this response. |
| `POST /v1/tools/cancel_work` | `{"session_id":"<id>","arguments":{}}` | Best-effort JSON acknowledgment. Used for spoken cancel and always attempted on call teardown. |
| `POST /v1/sessions/<id>/end` | `{}` | Best-effort JSON acknowledgment after `cancel_work`; failure does not imply broker-side cleanup was confirmed. |

## Inbox cursor semantics

On start, Dash reads its saved cursor from AsyncStorage under `dash.voice.inbox.<credentialId>` (valid decimal nonnegative integers only), calls `GET /v1/inbox?after=<cursor>`, and advances to each returned `after`. It repeats while `has_more` is true, **discarding all startup messages** so historical results cannot speak. Subsequent polls occur once per second. The broker should make `after` monotonically nondecreasing, page only items newer than the supplied cursor, and return `has_more` accurately. Dash saves the returned `after` and filters live items to the minted `session_id`; messages must have a `params` object even if empty.

At teardown, the app closes its peer/mic first, then attempts `cancel_work` and `sessions/<id>/end`. These requests should be idempotent. A failed response or network timeout is not evidence that work stopped.

## Lanes and the routing trace (DA-024)

An inbox message may name the z0live lane that produced it in `params.lane` (or a top-level `lane`), for example `"fast"` for the small model that answers small talk or `"meta"` for the large model that takes a task into the attached Hermes session, and the ask it answers in `params.call_id`. Both are optional; a broker that sends neither still works. Dash shows the lane and the time from the user's final transcript to the answer's arrival in the live call screen's routing trace (`voice-route`), tags the spoken line with the lane, and logs `[voice] route lane=<lane> first_token_ms=<ms>`.

After each `ask_z0`, Dash polls `GET /v1/inbox` every 100 ms for up to 3 s (one request in flight), then falls back to the 1 Hz poll. A fast-lane answer therefore waits tens of milliseconds for Dash rather than up to a second. Quick polls do not count toward the three-failure stop.

## SDP and fixture boundary

The normal provider answer is the SDP text response from `POST https://api.openai.com/v1/realtime/calls`, using the minted provider secret. In **web-army-only** builds, TURBO-C02 routes that signaling call to `POST <loopback broker>/v1/fake/answer`, which replies with SDP text starting `v=0`; this is a fixture extension, **not** a deployed broker endpoint.

`e2e/mbp-army/fixture-z0live-broker.ts` and `voice.spec.ts` exercise the real Expo web app and real bridge with a local broker and scripted web peer. They are not proof of native WebRTC capture/playback, speaker selection, Android permissions, deployed z0live, or a real OpenAI realtime call.

The web army pairs its WebSocket normally, then provides ephemeral `window.__dashVoiceArmy = {dash, z0live, identity:{credentialId}}` credentials through Playwright's pre-navigation initialization script. This identity exists only with `EXPO_PUBLIC_DASH_VOICE_FAKE=1` and is not enrolled, stored in settings, or sent as the WebSocket credential. Production web builds still cannot start continuous voice.
