# Testing Dash

**The test suite is the e2e tester army** (`e2e/mbp-army`): the real Expo web
app, an authenticated real Bun bridge per test, and a deterministic ACP fixture
agent. No route mocks, no store seeding, no phone, no live services.

```bash
bun run test            # = scripts/army.sh: web export -> army -> O15 receipt for HEAD
```

Needs bun, node, `bwrap` with unprivileged user namespaces, `ffmpeg`, and Playwright
Chromium (`node node_modules/playwright/cli.js install chromium`). Channel-denial
journeys also need HEAD's parent, so shallow CI checkouts use depth 2. Runs headless
on any host and in CI. The MBP headed variant on a private headless compositor
is `python3 e2e/mbp-army/run.py <name> <workers>` (see `e2e/mbp-army/README.md`).

## Annotation coordinates

The tldraw contract journeys keep the normal exact Skia parity check and exercise
a positioned DOM canvas whose origin changes without a resize. They derive page
coordinates from the rendered canvas and shape-layer transform, draw with real
mouse input, and inspect the authenticated upload. The existing zoom journey
separately covers camera transforms. No editor, store or camera setter seeds ink.

Pointer capture refreshes the editor's viewport bounds before converting samples;
the SDK's throttled resize/scroll observer alone cannot track position changes.
This does not reset the camera or compensate with a fixed coordinate offset.

## Session filters and sort

`e2e/mbp-army/chat-filters.spec.ts` covers the combined harness, exact project,
local-date, pagination and visual-sort controls. The Active session journey
uses two isolated hosts with the same native session ID. It checks membership
under Recent, Oldest and Priority, then removes an offline host.

Active means a current host-scoped running or open session, or a phone turn
in progress. It includes an idle session held in a host TUI. Saved history
alone does not qualify. Active does not scan archive pages. Switching back
to All sessions preserves access to saved history.

The combined journey also crosses successive history pages. A completed page
must release its single-flight entry before notifying subscribers, so a filter
scan can request the next page without stalling.

Stopping a pending or streaming turn updates that chat's activity time, so
Recent sorting reflects the interruption. A Stop with no active turn does not
manufacture newer activity. The priority journey checks both attention order
and the stopped chat's position after switching back to Recent.

The annotation voice-target journey selects the exposed edge of the chat row
while the centred voice orb keeps its mute hit target. It must keep the call
active and still prove that OMP ink is not sent to the attached Hermes session.

Run the complete suite on the integrated commit before RC3 merge. A filtered
feature run is not a complete release receipt or native phone acceptance.

The roster reconnect journey holds an unchanged real HTTP body while a newer
socket admits and its roster completes. It then releases the old body and reads
the rendered host row immediately, before the next periodic poll can mask a stale
replacement. Roster completion must retain its originating connection generation,
even when reconnect reuses the same Settings object.

The restored OMP journeys start two isolated, real roster processes holding the
same persisted transcript, with both equal and different launcher directories.
Each sends through the adopted chat, closes its first pane, and sends again
through the survivor into the same native session. Pane ids identify liveness,
not separate conversations. Handover requires the same host and native session;
it does not adopt a foreign endpoint or change Hermes profile identity. The
survivor supplies the current launcher directory for the ACP request. With no
surviving pane, native OMP chats still end. These journeys do not establish phone
acceptance or real OMP file resolution.

`next-action.spec.ts` also covers current-connection attention, identity-based
unread replies under clock rollback, exact-chat navigation without sending,
draft preservation, defer/reload and explicit permission decisions. CI retains
compact filter and attention screenshots in `chats-ui-<sha>` for visual inspection.

Clock-controlled attention journeys install their advancing clock before the
first navigation. They must not replace animation timing during an opening
morph. The rollback journey still moves system time backward while ticks advance;
it does not freeze Date, force actions, retry failures or relax assertions.

The remote ACP journey first sends a normal chat through the UI, then submits
an authenticated unsupported steer to that same remote route. It requires an
error without a second ACP invocation or reply delta. Remote routing preserves
the supplied mode so the existing Turn admission rejects unsupported steering,
rather than silently executing a new normal prompt. This is protocol rejection
coverage, not a claim that the Claude composer offers steering.

## Release law O15

No green, complete army receipt for the exact commit means no APK, no phone
install, no channel/OTA promotion and no merge. Law, proof and checker:
`laws/release/` (README there). Every army run writes the receipt;
`laws/release/check.py` is the only gate, called by CI, `scripts/build-native-android.sh`,
`scripts/phone-install.sh` and `.github/workflows/promote-preview.yml`.

Coverage is complete when every feature in `e2e/mbp-army/features.json` has a
passing army test and nothing was skipped without a reason. Add a feature
together with its army test. Never remove a feature or a test to get a pass.

## Other gates

| gate | command |
| --- | --- |
| O15 checker | `python3 -m unittest laws/release/test_check.py` (evidence rules; parity with the Bend book where Bend is installed) |
| typecheck / lint | `bun run typecheck`; `bun run lint` |

There is no unit-test suite and no mutation gate: the army is the suite.

Web army evidence is not native phone acceptance: native IME, voice, Android
permissions and live model behaviour are not covered yet
(`not_yet_in_army` in `features.json`). Never report a test, screenshot or phone
check as passed unless it ran against that exact commit.

## Export variant isolation

Metro's transform cache is namespaced by the sorted `EXPO_PUBLIC_*` inputs.
These values are compiled into the client. A warm cache must not carry debug,
demo or fake-voice code into another variant, nor suppress a requested variant.
The namespace preserves warm reuse for the same inputs without a global cache wipe.
`export-variants.spec.ts` exports production → debug → production with one private
warm cache and drives each actual export in the browser. Production must show
Pair and debug must show the workspace. Logs, screenshots and traces remain as
evidence; the test removes its generated bundles and compiler cache.

## History and endpoint ownership qualification

`history-ownership.spec.ts` exercises newest-history ownership in the browser,
including asynchronous cache hydration of an inactive Hermes transcript before
its fresh native request. The delayed, unknown and unchanged response cases also
cover partial native-user persistence and canonical catch-up.
The reopened-chat journey holds actual older HTTP responses across a closed visit.
It changes a row in the isolated native journal without changing its keyset,
then checks the current prompt through the rendered rail and transcript.
The full-message reopen journey holds actual `/chats/message` bytes while the
isolated native row changes, rejects the closed visit's response, then expands
the current row normally. Full-text reads use the same visit fence as older
pages: a revoked completion returns no text to the screen's replacement callback.
`history-lifecycle.spec.ts` exercises controlled production-consumer transitions:
endpoint A → B → A with a newer cursor, closed/reopened loader ownership,
partial native persistence/catch-up, nonempty shared-anchor rewind, and a native
poll beating durable load despite host/phone clock skew.
Each loader owns its flag through a token: stale work cannot supply a page or
clear a replacement loader's flag.
Background fills and scrolls waiting on them also belong to an open visit.
Closing the chat revokes that visit before a replacement can reuse its cursor.
A late fill cannot populate the replacement transcript or move its unlisted
rows into the visible list. These lifecycle cases exercise production consumers,
not browser or native-phone acceptance.

Native ids anchor transcript order. Alignment starts at a shared anchor (or the
first phone turn), not at any later repeated prompt. Comparisons use the native
producer's redaction rules. Richer multipart/cut/stopped replies retain the
observed native user/reply ids they already represent, so a moving source window
cannot duplicate their partial reply after its prompt leaves the window. These
bounded display associations are not source-identity or completion attestation;
a native row growing beyond the retained phone text remains visible as new
evidence. Ambiguous pre-existing duplicate turns are not destructively deduped.
`history-merge.spec.ts` exercises native catch-up and moving-window behaviour
through a real isolated remote journal and bridge.
`history-reload.spec.ts` covers active/inactive offline reload and a roster update
to an unopened index stub. Phone-only completed turns and ordering anchors are
durable; tool payloads remain host-owned and native history remains cacheable.
`persistence-lifecycle.spec.ts` exercises a bounded cache suffix disjoint from an
older durable phone turn, cache disclosure enrichment without stale-answer
replacement, and a corrupt unloaded file alongside an unrelated durable save.
Native refresh, cache, durable load and concurrent stub hydration share one
ordered matcher; only a newest native snapshot may revoke a native suffix.
Unreadable durable input is preserved and reported after unrelated saves drain,
and a failed startup transcript load does not skip the other needed chats.
Older-page membership follows server keysets and native ids, not the oldest
retained phone timestamp. The list and prompt rail place native pages around
retained phone turns by their native anchors. An old local turn must not discard
the intervening native page or put it above its older native anchor. Projection
source ids place rows that precede a retained phone prompt before that prompt.
Prompt jumps resolve the actual visible row id, not an assumed unlisted-prefix
offset, and re-resolve it after row measurements change.

A nonempty newest window ending at a shared native id can revoke a newer native
suffix. Empty native history currently also means unavailable at the bridge
boundary, so it cannot safely clear the display after undo-to-empty. A native
tool-round assistant anchor likewise cannot attest final text persistence after
both the final save and its retry fail. Neither case is claimed as fully recovered.

`legacy-recovery.spec.ts` has nine browser cases. Legacy/unowned, foreign and
same-endpoint sessions without a host binding retain their saved-local drafts
beside the current endpoint's resumable native rows in list and search. The user
explicitly selects the native result; no saved chat acquires an inferred host.
Harness search reuses an empty chat only when it belongs to the current endpoint;
it must not rebind a legacy or foreign chat.

`endpoint-ownership.spec.ts` drives the real ChatScreen phase poll and MessageRow
retained-tool request through A → B → A. Phase reads must resume on A and never
carry A's native target to B; retained tool requests must obey the turn owner.
`annotation-voice-target.spec.ts` adds provenance assertions for exact-address,
legacy, foreign, stale and retry targets alongside its existing voice journeys.
Device self-check must report a missing owned eligible Hermes target as failure,
not voice readiness. New-chat creation can still use the global online connection
before a conversation exists.

`paired-session-continuation.spec.ts` uses an isolated real bridge without a
native OMP roster holder: first streamed reply, persisted cache, cold reload,
fresh authenticated hello explicitly missing that native session, then a second
real ACP request with the original session id and confirmed paired host.
The client only adopts the known self host for an unscoped same-endpoint session
with matching harness and explicit ACP/legacy transport. Existing selected
native/profile/remote targets keep their original routing and lease rules.
`native-continuation.spec.ts` and `fx-native-acp.spec.ts` additionally wait for a
genuine changed roster after the executor exits, then require a second ACP
`session/load` with the original native id. Noncatalog continuation requires
the existing matching generic local harness profile, not an arbitrary profile.

`live-search-ownership.spec.ts` uses an actual UI-created, completed durable chat
as its legacy upgrade input. It closes the old runtime and bridge before
transforming that input at document initialization, then verifies the unowned
saved state before reconnecting. This prevents live persistence or authenticated
session replay from restoring ownership during fixture setup. Native recovery
after local deletion must still leave that ambiguous saved chat separate.
New ACP chats already have a confirmed host and must not be treated as unowned.
The subagent-strip journey opens Orchestra's
Fleet view before it checks full-graph classification; hidden panes and the
Lineage projection are not the full fleet.

These browser fixtures and controlled production-consumer tests are not S25 or
native-host qualification. They do not establish live MBP/Groot harness connectivity,
reconnect/session-switch acceptance, microphone, native WebRTC or live voice
delivery. No native voice activation, credential grant or token issuance is
authorized by these tests. Registry entries describe coverage, not a claim that
these new or strengthened tests have passed.
