# Living Night phone proof

The implementation follows [zeros-night.md](zeros-night.md). No bridge, protocol, or production store logic changed.

## What changed

| Screen | Presentation |
| --- | --- |
| Main / Chats | Visible top tab labels and centred gold selection dot. Header compose and bridge controls. Cormorant date groups, mono counts and times, static source-catalog harness orbs. Ended sessions are tertiary and cannot show a live dot. |
| Focused search | The `@` is inside a 52 px glass pill. Focus opens `@bot`, `@chat`, and `@file` chips above it. The file shortcut uses the existing `/file` search route; search parsing did not change. |
| Bots | Serif host sections, mono addresses and paths, source-catalog identity orbs, truthful adjacent status dots. Unavailable agents remain readable. |
| Orchestra / detail | Full-width 14 px glass cards, editorial project names, mono host/path metadata. Unknown topology says “Topology not reported” instead of occupying a large empty diagram. Existing declared topology rendering stays intact. |
| Chat / streaming | Compact serif title and back/harness controls. Plain assistant text, strong-glass user bubbles, 4 px running status dot. Composer has a single-line input and one attach / mic / send-or-stop row. |
| Pair | Editorial title, glass fields, a shared garden-style gold gradient primary button and ghost secondary actions. Enrollment requirements are unchanged. |
| Settings | Serif group headings, glass groups, mono machine values and the shared gold save/reconnect control. Approvals remain reachable when there is no pending tab badge. |
| Voice | Source Atmosphere / Spectrum / Perimeter / Light ring appearances and the official ElevenLabs shader in a local adapter. Hermes defaults to Atmosphere; Grok to silver. Shared z0live handoff stays idle and says the microphone is off. Only actual legacy voice state drives active phases. Volume inputs stay zero; there is no synthetic amplitude. |
| Approvals | Garden-style Pending / Bulk-ready / Blocked metric strip, editorial item titles, glass cards and gold bulk-approval CTA. Approval, exact-body confirmation, dry-run and posting boundaries stay unchanged. |

Fonts are pinned Expo Google Fonts packages. They load before first UI paint. The token port records the OKLCH-to-sRGB conversion beside each value. Glass blur is opt-in and never enabled for scrolling cards. The ElevenLabs notice is retained at `app/src/components/vendor/ElevenLabsOrb.NOTICE.md`.

## Images

Every required frame is 390×844. The capture command also covers the harness picker, Orchestra detail, and the original renderer aliases.

- Original before files, preserved without alteration: `/mnt/zer0models/project-artifacts/dash/zeros-ui-20261020/before/`.
- Complete before rerender at baseline `2ba915d871303fd302ffb2f5bd2747cff3405185`: `screenshots/zeros-ui-before/` and `/mnt/zer0models/project-artifacts/dash/zeros-ui-20261020/before-regenerated/`.
- After: `screenshots/debug/` and `/mnt/zer0models/project-artifacts/dash/zeros-ui-20261020/after/`.
- Side-by-side pairs: `/mnt/zer0models/project-artifacts/dash/zeros-ui-20261020/pairs/`.
- Proof Mono: `/mnt/zer0models/project-artifacts/dash/zeros-ui-20261020/proof-mono/`. Selected copies are committed under `screenshots/zeros-ui-proof-mono/`.

Required filenames in both before/after sets:

`main-chats.png`, `main-chats-search.png`, `main-bots.png`, `main-orchestra.png`, `chat.png`, `chat-streaming.png`, `pair.png`, `settings.png`, `voice.png`, `approvals.png`.

These are debug fixtures, not live telemetry. The after Chats seed adds an ended session. The after Approvals seed adds explicitly dry-run proposals so cards and metrics can be reviewed; the old approvals baseline was empty. No proposal is posted by these screenshots.

## Verification

```sh
cd app && bun test
cd ../bridge && bun test
cd .. && bun run test
bun run typecheck
bun run lint
bun scripts/mutate.ts
cd app && bun run debug:shots --port 8108
EXPO_PUBLIC_ZEROS_THEME=proof-mono bun run debug:shots --port 8110 --out /mnt/zer0models/project-artifacts/dash/zeros-ui-20261020/proof-mono
```

`scripts/assert-living-night.mjs` exercises rendered geometry: real visible tab labels, contained `@`, focus-only chips above the dock, mono ended state, consistently stretched project cards, single-line composer, 44 px ordered control targets, truthful idle voice, and compact labelled approval metrics. It also clicks through tab switches, bridge details open/dismiss, compose/back, focus/blur, stop, voice appearance, and bulk confirmation/cancel without posting. The baseline fails the `@` assertion; the new renderer passes. `geometry.json` records every frame and browser page error.

Every required Living Night frame was opened and inspected personally, as were the picker, project detail, and Proof Mono Chats/Approvals frames. Review corrections included shrinking project cards, missing focus chips, a browser-default input focus outline, stale session presentation, a broken old detail fixture id, and an invisible old bridge drag strip that intercepted the labelled tabs. Web ARIA selection is now explicit as well as native accessibility state.

Fonts, UI source, orb assets, the lockfile, and the rendered assertion harness are hashed into each capture receipt. Packaging refuses a stale source hash. Both themes passed with the same source fingerprint and no browser page errors.

| Gate | Result |
| --- | --- |
| `cd app && bun test` | 186 passed, 0 failed |
| `cd bridge && bun test` | 134 passed, 0 failed |
| `bun run test` | 386 passed, 0 failed |
| `bun run typecheck` | Passed |
| `bun run lint` | Passed |
| `bun scripts/mutate.ts` | 93, above threshold 80 |
| Android production export | Passed |
| Living Night capture + real UI journeys | 15 frames, 0 page errors |
| Proof Mono capture + real UI journeys | 15 frames, 0 page errors |

Old renderer source assertions were intentionally updated for the new visual contract. Existing pure pager/motion tests and numeric mutation canaries were retained. Mutation score: 93 (75 killed of 81, threshold 80).

## Boundaries and limitations

- Browser rendering, geometry, click-through journeys, and an Android production export are verified. No physical phone, Android blur performance, microphone capture, or real model turn was exercised. The owner's Metro on 8097 was not stopped or repointed.
- The live doctor could not connect to its configured `http://127.0.0.1:4747`; it did see Metro return 200. No replacement bridge was started.
- Shared z0live does not publish its voice phase to this screen. Its orb therefore remains idle rather than pretending to listen. Legacy voice has the real phase subscription.
- Attachments remain unsupported by the bridge. The attach control explains that limitation; it does not pretend to upload a file.
- `no-mistakes axi status` reported that the repository is not initialized. No new pipeline configuration was introduced. Repository tests, lint, typecheck, mutation and rendered proof were run directly.
- No merge, force-push, or changes to the parallel Hermes-session producer lane.
