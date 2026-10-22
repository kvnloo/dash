# Prompt rail: evidence and encoding decision

Research date: 2026-10-21. Sources retrieved with Exa search through agent-reach; teardown page fetched through Jina Reader. Two teardown images were opened and inspected directly. This is not a reverse engineering of a logged-in ChatGPT build or a native-phone inspection.

## What ChatGPT's lengths mean: not established

OpenAI's [release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) document a table of contents in conversations longer than five responses, but do **not** document tick-width semantics. [OpenAI Support's community reply](https://community.openai.com/t/navigation-scrollbar-position-indicator/1393363/3) points to those notes and distinguishes that feature from requests to restore the scrollbar/position indicator.

A [user report](https://www.reddit.com/r/OpenAI/comments/1tt9v1j/chatgpt_makes_it_easier_to_navigate_in_threads/) describes one bar per user prompt and hover previews of prompt opening words. That is observational evidence, not an OpenAI specification. [The Scalevise teardown](https://scalevise.com/resources/chatgpt-scroll-timeline-ui/) includes [a rail image](https://scalevise.com/resources/content/images/2026/04/chatgpt-new-right-sidebar.jpg) showing approximately equal-width strokes with the final one brighter, and [a hover image](https://scalevise.com/resources/content/images/2026/04/ChatGPT-Scroll-Timeline.jpg) showing a list of user prompts with the final prompt highlighted. Neither image establishes response length, tokens, duration, tools, cost or importance as the width input. Its claim about “structure and length” is not a width formula.

An indexed [ChatGPT-style third-party implementation](https://github.com/invalidnaaaame/dsh-scroll-timeline) explicitly describes widths 39/30/21/15/9 according to distance from the hovered/current anchor: a magnetic mountain, not content magnitude. Direct GitHub retrieval returned 404, so its implementation was not verified; treat this as an indexed description, not first-party source. It is a plausible explanation of varying widths in some rails, not proof of ChatGPT's behavior. No public first-party ChatGPT client source or controlled before/after video establishing width semantics was obtained. The honest answer to the owner's exact question remains **unknown**.

## Comparators and transferable lessons

| Surface | Evidence | Lesson for Dash |
| --- | --- | --- |
| Claude / Gemini | [Voyager Timeline guide](https://voyager.nagi.fun/en/guide/timeline.html) documents a third-party rail with hover previews, jump, stars and experimental hierarchy across these clients. This is not a claim of a built-in native rail. Indexed Claude plugin source describes accumulated markers across virtualized windows; direct GitHub source retrieval returned 404 and was not verified. | Stable message identity; previews should not depend on which rows happen to be mounted. Stars are explicit importance, not a model guess. |
| Cursor | [Agent overview](https://cursor.com/docs/agent/overview) documents checkpoint previews and restores from earlier requests; restore changes files, not conversation messages. | Navigation, continuation and rollback are different actions. Never offer rollback without a real snapshot. |
| VS Code | [Theme API](https://code.visualstudio.com/api/references/theme-color) defines minimap and overview-ruler markers for errors, warnings, edits and search. [Minimap sizing](https://code.visualstudio.com/updates/v1_43) documents proportional/fit/fill sampling. | One channel per meaning: volume in geometry, state in colour, change landmarks separately. Sampling becomes necessary beyond pixel resolution. |
| Slack | [Activity guide](https://slack.com/help/articles/46751260742035-Introducing-the-new-Activity-view-in-Slack) describes dense previews, filters and explicit clearing/read state. | Unread is a user-state variable, not answer importance. Don't mark read just because a finger crossed an anchor. |
| Linear | [Inbox](https://linear.app/docs/inbox) separates Priority, unread, snooze and notification actions. | Owner attention needs a queue with explicit dispositions, not a rainbow heatmap. |
| YouTube | [Seeking help](https://support.google.com/youtube/answer/12825599?hl=en) explicitly defines graph height as frequency of replay. | Heat requires actual aggregate behavior and adequate evidence. Do not call a speculative score a heatmap. |

These are interaction comparators; Slack/Linear are not asserted to have the same horizontal-stroke rail.

## Width decision

Default: **answer reading volume**, measured in stored answer characters. It exists offline, needs no model call, is deterministic and helps locate substantial results. Formula: `8 + 24 × min(1, log1p(chars) / log1p(12000))` logical pixels. Invalid/nonpositive values give 8px. A fixed logarithmic scale prevents one huge answer dominating and keeps old bars stable when a new reply arrives. Characters are explicitly not tokens or measured rendered lines; current streaming text remains in the per-reply text store and does not continuously rebuild the rail.

Rejected defaults:

- Duration × tools: missing reliable start/end and actual invocation events; multiplication overweights slow or repetitive failures. Later show duration and invocation count independently if instrumented.
- Files changed / PRs: good landmarks but not all useful work changes code. A path mention is not a diff. This version labels absolute-path references, detects diff fences and GitHub PR URLs, and does not claim a change was applied or merged.
- Cost: model/provider accounting is incomplete and cost is not owner value. Never infer spend from text length.
- Importance: needs explicit stars or calibrated acceptance outcomes; do not hide an unvalidated ranker behind width.
- Unread/new: requires a persisted read boundary. Keep as an independent outline/badge later, not an overloaded size.

## Implemented interaction

Display-rate worklet selection; ordinal-change preview/haptics; memoized tick subtree. No transcript seeks during drag; one FlashList measured-offset/index jump on successful release. Cancel does not jump. No guessed predictive cache is needed in the drag loop; the existing measured-offset safety check remains at final commit. Existing memoized rows and Markdown remain unchanged.

Neutral done, red reported error, blue streaming and amber explicit waiting-for-approval/clarification status. Labels accompany colours. Historical question-ending answers get a tiny dot; diff-fence/PR references get a tiny diamond. Neither is a resolved-decision tracker or a count of applied changes.

Popover: prompt first line, cached final-answer first-line excerpt (reasoning stripped; explicit failures take precedence over partial success text), stored-answer character count, honestly labelled activity-update count, file references and PR when present. Jump, Copy, Open PR, Copy file path and Continue are contextual controls. Continue explicitly confirms draft replacement and sends nothing; it does not branch or rewind the session. Latest is always a separate 44px target. Mouse hover previews without navigation. Native selection haptics tick at crossed anchors; amber/red use an impact tick. Actual physical feedback remains unverified.

## Deliberately not faked

No remote `*role*` branch or pushed `bridge/src/model-roles.ts` was found at qualification. This branch therefore ships the immediate cached excerpt fallback, labelled as an excerpt, **not generated smol summaries**. Integrate the model-roles worker's authenticated interface once published: generate only for settled answer revisions, bound concurrency, cache by session/turn/revision/model/prompt version, reject stale results and never block scrubbing on it. No duplicate provider or ad-hoc inference endpoint was added.

Duration, real tool counts, actual changed-file counts, host-file opening, topic shifts, unread persistence, importance ranking and accept/reject telemetry are not implemented. Those need real schema/events or an existing safe viewer. Copying a host path is safe; treating it as a phone-local URL is not. Question detection is a heuristic retrieval mark, not authorization or a substitute for the Needs Kevin queue.

At 220 anchors the rail is intentionally dense. Beyond one anchor per physical pixel, aggregate into bins with error/needs-you precedence and add fine ordinal selection; do not render zero-height strokes or drop urgent states. This larger-scale mode is proposed, not shipped.
