# Dash UX reuse survey, 2026-10-20

## Decision

Keep FlashList 2.0.2 and Dash's per-reply text subscriptions. Use `react-native-marked` 8.3.2 through its `useMarkdown` hook, Prism 1.30.0 with a limited grammar set, and Expo Clipboard 57.0.2. Use the already installed Gesture Handler, Reanimated and Worklets for the prompt rail. No new service, WebView, chat state framework or development-client rebuild.

The first implementation used `react-native-markdown-display`. Source and release inspection changed that choice. Its latest npm release is from 2023 and uses markdown-it 10. `react-native-marked` has a current release, selectable RN text, a renderer extension point, and the same parser family as OMP and opencode. Its hook avoids putting another vertical virtualized list inside FlashList.

Research used GitHub CLI through the agent-reach GitHub route, shallow source checkouts, npm registry metadata, and local screenshots. Repositories were inspected read-only. Exact revisions, source links, last-push dates, archive flags, npm versions and package sizes are in [sources-20261020.json](sources-20261020.json). Upstream heads moved into October 21 during this pass. Dates are observations, not promises of ongoing support. No candidate application was installed or executed.

## Cost definitions

Application rows below say **not embeddable** when they are complete web/desktop/TUI applications, not RN packages. Their incremental Dash bundle cost is zero because none is imported. Porting an entire application has no meaningful npm bundle estimate.

RN package sizes below are npm `dist.unpackedSize`, rounded to KiB, excluding dependencies. They are install-size evidence, **not Metro bundle sizes**. Costs for rejected packages were not measured in a Dash build. Shiki's grammar/theme packages and react-syntax-highlighter's engines must be counted separately; comparing only their wrapper sizes would be misleading. The source snapshot lists dependencies for that reason.

A standalone minified browser build of the selected marked lexer and Prism imports measured **75,283 bytes**, or **25,420 bytes gzip**. This excludes RN renderer components, table/list helpers, React, Expo and platform bytecode. It is an engine-only cost measurement, not an asserted full-app Metro delta. The exact package lock is committed; a native release-size comparison remains unmeasured.

## Agent applications and web libraries

All are active, non-archived at the inspected head unless stated otherwise. The source snapshot has exact push dates.

| Candidate and layer | License | Source inspected and useful behavior | RN/Expo and cost | Decision / owner request |
| --- | --- | --- | --- | --- |
| [t3code](https://github.com/pingdotgg/t3code), app | MIT | `apps/web/src/components/ChatMarkdown.tsx`: react-markdown, cached/incremental Shiki output, file-path links and clipboard handling | DOM/desktop app, not embeddable | Reuse the pattern: readable prose, bounded code containers, copy beside code. Not its React DOM renderer. |
| [oh-my-pi](https://github.com/can1357/oh-my-pi), TUI | MIT | `packages/tui/src/components/markdown.ts`: marked token processing, streaming-source stability, fences, tables and terminal-width layout | ANSI terminal components, not RN; no added bundle | Use marked's GFM/fence conventions. Do not port the terminal renderer or its width calculations. |
| [Hermes](https://github.com/NousResearch/hermes-agent), official TUI and desktop/web client | MIT | `ui-tui/src/components/markdown.tsx`: Ink text, line highlighting and fence parsing. `apps/desktop/src/components/assistant-ui/markdown-text.tsx`: assistant-ui Streamdown adapter, tail-bounded incomplete-Markdown repair, lazy code plugin and Shiki | Ink and DOM clients, not RN; no added bundle | Tool/reasoning disclosure and prose-first hierarchy match the request. Hermes itself has multiple renderers, not one RN library to import. |
| [Hermes Web UI](https://github.com/EKKOLearnAI/hermes-web-ui), separate community app | MIT at inspected metadata | `packages/client/src/components/hermes/chat/MarkdownRenderer.vue`: markdown-it, HTML disabled, fence repair, highlighted copy controls, file previews | Vue/DOM application, not RN | Borrow safe rendering and file-chip behavior; do not mistake this project for the official Hermes client. |
| Tern / Stencil TSP, terminal frontend | License and renderer implementation unverified | Stencil's public Tern page and `theblazehen/awesome-tern` identify the terminal and plugin ecosystem. Owner issue `kvnloo/oh-my-pi#143` describes the Tern/Luau path | No verified embeddable RN renderer or npm bundle | TSP is a transport/presentation integration, not evidence of an RN Markdown package. No invented dependency claim. Public catalog and issue evidence do not qualify a native build. |
| [OpenAI Codex](https://github.com/openai/codex), CLI | Apache-2.0 | `codex-rs/tui/src/markdown_render.rs`: pulldown-cmark events to Ratatui, compact streaming lists, bounded tables, highlighted code and local file links | Rust TUI, not RN; no added bundle | Prompt navigation is the owner's interaction reference. The proprietary Codex app implementation is not in the CLI repository. No claim that its mobile rail source is available. |
| [opencode](https://github.com/anomalyco/opencode), app/TUI | MIT | `packages/web/src/components/share/content-markdown.tsx`: marked + marked-shiki, expandable content and CopyButton | Solid/DOM and terminal clients, not RN | Supports selecting marked's format while replacing only the RN view layer. |
| [Claude Code UI](https://github.com/siteboon/claudecodeui), representative clone | AGPL-3.0 | `src/modules/chat/transcript/Markdown.tsx`: ReactMarkdown and syntax-highlighter boundary | DOM app, not embeddable | Inspect interaction patterns only. Do not copy AGPL application code into Dash. This is a representative clone, not an audit of every clone. |
| [LibreChat](https://github.com/LibreChat-AI/LibreChat), app | MIT | `client/src/components/Messages/Content/CodeBlock.tsx`: code actions, tool result switching, sticky code toolbar via IntersectionObserver | DOM app plus server, not RN | Keep Copy discoverable at the code header. No server migration or code execution button. |
| [Open WebUI](https://github.com/open-webui/open-webui), app | Open WebUI License; historical files have MIT/BSD terms | `src/lib/utils/codeHighlight.ts` and `LICENSE`: highlighting boundary; branding restriction with exceptions, not simply MIT | Svelte/DOM/server app, not RN | Reference only. Do not import branding-restricted application code or add a server for text rendering. |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui), UI framework | MIT | `packages/ui/src/components/react/ui/base/code-block.tsx`, thread viewport/autoscroll sources: copy/disclosure and viewport ownership | React DOM components, not drop-in RN | Good message-part model, but migrating Dash's store would be unnecessary. Preserve per-turn subscriptions instead. |
| [AI Elements](https://github.com/vercel/ai-elements), component registry | Apache-2.0 | `packages/elements/src/conversation.tsx`: use-stick-to-bottom, explicit scroll-to-bottom action | DOM + Radix/CSS assumptions, not RN | Reuse the follow-vs-read interaction model, not a DOM scroll hook. |
| [Streamdown](https://github.com/vercel/streamdown), renderer | Apache-2.0 | `packages/streamdown/index.tsx`: block parsing, incomplete-fence handling, remend, rehype hardening/sanitization and code plugins | DOM output, not RN; plugin-dependent cost, unmeasured | Useful streaming reference. Do not run its HTML renderer in a new WebView. RN marked already handles unfinished fences as code. |
| [CopilotKit](https://github.com/CopilotKit/CopilotKit), agent UI SDK | MIT | v2 `CopilotChatReasoningMessage.tsx`: reasoning disclosure with user override; v1 source explicitly marks itself deprecated | DOM components plus agent/runtime integration; not drop-in RN | Copy the disclosure concept, not its chat/runtime protocol. Dash intentionally keeps reasoning collapsed even during streaming. |
| [o8](https://github.com/hurttlocker/o8), agent control room | MIT | `src/app/mobile/mobile-markdown.tsx`: phone-web renderer, code tokens, tappable file paths, copy/long press | Next/DOM mobile web, **not React Native** | This is the likely intended o8: its stated purpose matches Dash's README description of a control room. Owner confirmation remains open. Reuse file-path affordance and mobile density ideas, not its custom Markdown parser. |

### What these sources agree on

Separate the answer from the execution trace. Use one-line summaries with optional details. Keep user prompts visually distinct without wrapping every assistant paragraph in a large card. Put the copy action on the code block. Preserve reading position when output arrives; make return-to-live an explicit action.

These patterns do not require adopting a new chat application. No reviewed application provides a drop-in Expo Go prompt rail. Alphabet indexing packages below solve a different data model.

## React Native building blocks

| Candidate | License and maintenance | RN/Expo compatibility | Install-size / bundle-cost evidence | Request covered and decision |
| --- | --- | --- | --- | --- |
| Shopify FlashList | MIT; active, registry 2.3.3 | Already installed at 2.0.2, current New Architecture app | Registry package 830 KiB; **zero new package cost** | Keep virtualization, measured layouts, scrollToIndex fallback and bottom initialization. Explicit follow state handles streaming row growth, not only appended messages. |
| Legend List | MIT; active, 3.6.0 | RN support; JS list, reasonable Expo candidate | 2,334 KiB plus use-sync-external-store; Metro delta unmeasured | `maintainScrollAtEnd` and anchoring are good chat APIs. Do not replace a working FlashList just to add a rail. |
| react-native-gifted-chat | MIT; active source, 3.4.0 release | RN; current peers include Gesture Handler, Reanimated and keyboard-controller, already present in Dash | 380 KiB plus dayjs, zoom and action-sheet dependencies | Grouping, chat list and bottom control, but replaces composer/message schema. Too much migration for this pass. |
| react-native-alphabet-flatlist | Not verified | Exact npm package and proposed GitHub path returned 404; no license/maintenance assumption | Unknown, not adopted | Do not install a guessed package. The named requirement is fast navigation, not alphabetical sorting. |
| AlphabetList / react-native-section-alphabet-list | MIT; last npm 3.0.0 in 2022; last inspected push 2023 | RN SectionList, no native module | 25 KiB plus section-list-get-item-layout | `ListLetterIndex` uses pressable letters, not continuous scrub. Assumes alphabetic sections and predictable section layout. Wrong fit for variable-height chronological prompts. |
| Existing Gesture Handler + Reanimated + Worklets | MIT packages; already installed | Existing Expo SDK-compatible dependencies | Zero new package cost | Selected. A small pan worklet maps rail position to prompt ordinal; only boundary changes reach JS for navigation, preview and Expo haptics. FlashList remains responsible for row layout. |
| react-native-markdown-display | MIT; npm 7.0.2 from 2023, source push 2026-03 | RN views, Expo-compatible JS; markdown-it 10 and fit-image dependencies | 68 KiB plus parser/dependencies | Render rules can provide copy/highlight. Prototyped, then removed because the maintained marked hook is a better final fit. |
| @ronradtke/react-native-markdown-display | MIT; active fork, 9.0.3 from June 2026 | RN views; source exposes MarkdownStream, incomplete-markdown sealing and onCopyCode. Vector-icon dependency requires Expo font/config review | 351 KiB plus markdown-it 14, prism-react-renderer and material-design-icons | Strong integrated alternative. More dependency/font assumptions than needed for one transcript. Not adopted, not claimed broken. |
| react-native-marked | MIT; active, 8.3.2 from September 2026 | RN Text/View, existing react-native-svg peer; no new native module | 261 KiB plus marked 18, svg/parser, list/table helpers | **Selected**. `useMarkdown` returns nodes, custom Renderer supplies highlighted code, selectable prose and safe link/image policy. Avoid default nested FlatList. Same parser family as OMP/opencode. |
| react-native-enriched-markdown | MIT; active Software Mansion upstream, 1.1.1 from October 2026 | Fabric native codegen components and platform code; **needs native integration**, not an Expo Go drop-in | 4,437 KiB package plus native code; RN binary delta unmeasured | Attractive native rendering/highlighting. Reject for this PR because a development-client rebuild violates the Expo Go rule. The initially found junko2013 fork is not the canonical registry source. |
| Prism / prismjs | MIT; active source, stable npm 1.30.0 from 2025 | Pure JS tokenization. RN Text spans, no HTML injection or DOM highlighting | 2,005 KiB npm package includes all distributed grammars; only core/default JS/CSS/markup and TS/bash/JSON/Python imports enter this implementation | **Selected**. Small adapter to RN Text and copy. Unknown languages and code over 50,000 characters stay plain, never discarded. Diff +/- lines get semantic red/green. |
| Shiki | MIT; active, 4.5.0 | Core token APIs can be adapted; web HTML APIs are not RN views. Engine/grammar loading needs Hermes/Metro qualification | 588 KiB wrapper **excluding** core, grammars, themes and engines | Excellent t3code/Hermes parity, but avoid all-language/theme payload and engine setup for this pass. Not inherently incompatible with RN. |
| react-native-code-highlighter | MIT; active, 1.3.1 | RN custom renderer around react-syntax-highlighter; Expo-compatible JS | 33 KiB wrapper plus react-syntax-highlighter/engines and style conversion | Valid alternative, but direct Prism tokenization avoids a second highlighter renderer and extra dependencies. Copy still needs a Dash wrapper. |
| Expo Clipboard | MIT; installed SDK-aligned 57.0.2 | Expo Go SDK module; install used `bunx expo install` | Existing SDK native capability plus JS wrapper; no rebuild. Registry latest 58 cost is not the installed version | **Selected**. Copy success/failure feedback, rather than a button that silently does nothing. |

### Message grouping and transport limits

Dash's wire/history model has user and assistant messages, not first-class historical tool/system/reasoning messages. This PR does not invent tool outputs or rewrite history. It retains up to 32 actual bridge status updates on each reply for a collapsed Activity disclosure. Consecutive identical statuses deduplicate. Existing archives remain valid because the field is optional.

Leading `<think>` / `<thinking>` sections get a separate collapsed disclosure, including an unfinished streaming section. Tags inside a code fence or ordinary prose remain literal. Reasoning that the bridge never transmits cannot be recovered. Complete tool arguments/results and rich ACP-specific cards remain future protocol work.

User prompts keep their compact right-aligned bubble; assistant Markdown uses the reading area; activity uses a muted hairline disclosure; errors stay red; system/handoff/connection notices remain outside answer prose. Pending approvals get a separate review link. Existing host file chips remain owner-initiated; fenced diffs add cheap inline change visibility. No execution, write-file or auto-download action was added.

## Open Design and the owner's existing work

All eight requested forks were cloned read-only under `~/work/design-skills/`: apple-design-skills, taste-skill, ui-ux-pro-max-skill, interface-design, superdesign, awesome-design-md, motion-skills and open-design. None was installed as a product dependency.

- The supplied September 8 spike says it sparse-cloned `nexu-io/open-design@677457d`. Both supplied HTML artifacts exist at `~/work/dash-ux-brief/open-design-spike/artifacts/{od-hermes,hermes-alone}/index.html`. They demonstrate an experiment, not an installed default.
- Current fork source `apps/daemon/src/runtimes/defs/hermes.ts` confirms `hermes acp --accept-hooks`, `streamFormat: acp-json-rpc`, `mcpDiscovery: mature-acp`, and `externalMcpInjection: acp-merge`. This is usable desktop/daemon integration evidence, not an RN transcript renderer.
- `od mcp install hermes` was never run in the supplied spike, Open Design did not become the default, and there is no omp wiring in that spike. This pass did not run that installer or add any wiring.
- [oss-factory#172](https://github.com/kvnloo/oss-factory/issues/172) is a promotion queue for Open Design, not a completed Hermes integration. It names fork PR #1 and scoped content-Markdown CI work. No promotion or merge authorization follows from it.
- Important correction from the live owner record: [oh-my-pi#143](https://github.com/kvnloo/oh-my-pi/issues/143) is an **issue**, not a PR. It now explicitly says the intended generation project is **thesysdev/OpenUI**, not Open Design. Native experiment #144 is closed/unmerged; the critical path moved to `base/tern-frontend`. It proposes reuse of lang-core and Tern/Luau, not a shipped Dash integration.
- Owner issue/PR searches found historical plans and promotion records. Do not relabel the September Open Design spike as an OpenUI integration. Neither is required to deliver prompt navigation or Markdown here.

## Design rubric applied

The supplied owner screenshots show about three horizontal chrome bands above the transcript, unparsed fences, raw trace content and oversized list metadata. Keep the existing Living Night palette, typography and navigation; do not import a landing-page theme.

- `apple-design-skills/skills/mobile-native`: respect the finger, use legible text and accessible targets. The rail is a 44px-wide adjustable control; Latest, disclosure and Copy targets are at least 44px high.
- `apple-design-skills/skills/animate-expo`: gestures run on the UI thread; no per-frame runOnJS. Only a changed prompt index schedules JS. Scrub jumps are immediate, without overshooting springs or decorative movement.
- `interface-design`: hierarchy through spacing, type and restrained borders. Keep answer text prominent, shrink metadata and section headings, and separate details from output.
- `ui-ux-pro-max`: touch targets, contrast, font legibility and progressive disclosure. Keep 16/24 prose, 13/20 code, horizontal code scrolling and labeled controls.
- `taste-skill`: inspect real rendered output and preserve identity on redesigns. Its marketing/gallery directions are not a reason to replace an agent-control interface.
- `superdesign` README marks the original extension as unmaintained. Use its inspect/iterate idea, not an obsolete extension runtime.
- `awesome-design-md` encourages a persistent product-specific design language. Dash already has `DESIGN.md` and `docs/design/zeros-night.md`; no foreign design system was copied in.
- `motion-skills` is a motion/video collection. Its deliver-and-verify loop is relevant; cinematic effects and video runtimes are not. No new ambient animation was added.

## Boundaries

This is a source survey and a host-rendered Expo web qualification, not a proof that every candidate runs in Expo Go. Native haptics, touch scrubbing on Android/iOS, keyboard behavior and a real model turn still need a reachable device/bridge. Local bridge doctor failed at port 4747, so this pass did not create a replacement bridge or contact host-b. See the result and screenshot qualification receipt for executed checks.
