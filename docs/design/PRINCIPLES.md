# Predictable next information

Dash should show the most important next information before Kevin has to ask for it. This is a product contract, not a promise that a model knows his intent.

## Start with the decision

For each surface, name the user's intent, the observed state, the goal, the roadmap milestone and the highest-priority unresolved action. Separate observations from inference and show missing or stale evidence. If those inputs are absent, provide navigation and a useful fallback rather than confidently guessing a priority.

A chat's first useful question is usually “what happened, and do you need me?” Show the result before process. A rail should reveal an earlier result without moving the transcript; release commits the jump. A long answer is not necessarily important. A tool-status update is not a tool call. A mentioned file is not a changed file. Never label these proxies as facts they cannot establish.

## Spend attention where it changes an outcome

Use neutral for settled work, blue for live work, amber for an explicit owner-input state and red for a reported failure. Pair colour with text; colour alone is not accessible. Historical questions and code/PR references are retrieval landmarks, not proof that an action is outstanding or that a change shipped. Never turn an inferred question into an approval.

The read-only Needs Kevin batch is the cross-session destination for owner decisions: [supervision #189](https://github.com/kvnloo/z0intelligence/pull/189), [Dash #82](https://github.com/kvnloo/dash/pull/82). Give each item a reason, options, evidence and freshness. Pull first, batch interruptions, and do not make an unresolved owner decision block unrelated safe work. A transcript rail complements that queue; it must not create a competing approval authority.

## Make the next action predictable

A control must say what it will do, expose the relevant evidence, preserve the reading position and have a way out. Preview is not navigation; navigation is not acceptance; Continue drafts a reference and does not rewind history or send a turn. Confirm replacement of an existing draft. Opening a PR never approves or merges it. Never open a host path as a phone-local file.

Frequent interactions must not trigger expensive work. Scrubbing updates the selection on the UI thread; only changed anchors cross to JS for preview/haptics. Keep transcript rendering, layout seeks and Markdown parsing out of the drag loop. Latest is a separate persistent target. Verify display-rate feedback on a representative long transcript, cancellation, final destination and keyboard/screen-reader paths. Native timing and haptics need native evidence; a browser result is not a phone result.

## Learn from explicit responses, not incidental motion

[Next-action-v0 #112](https://github.com/kvnloo/z0evals/pull/112) proposes pull-first recommendations and `next_action.v1` accept/reject events. Its baseline found zero commits and no accept/reject decisions despite thousands of predictions; recency outperformed the predictor on app switches. More predictions are not evidence of a better experience.

Every recommendation interaction should feed the accept/reject flywheel: stable suggestion ID, offered action, evidence/version, explicit response, eventual outcome and privacy boundary. Preview, scroll and dismiss are not rejection. Preserve “not now”, “wrong action” and “already done” as different feedback. Compare a learned ranker with a simple recency baseline on held-out outcomes before promotion. Do not silently upload chat text or turn navigation into training consent. This PR does not claim to install that event pipeline.

ROLES-v0 is the local routing reference (canonical path: `/mnt/zer0models/workspace/zer0/data/operations/roles/ROLES-v0.md`). It distinguishes deterministic code, shadow decision models, builders and Kevin's scarce judgement. Keep deterministic navigation deterministic. A smol summary may condense a settled answer, but must be cached by answer revision, labelled as generated, and fall back immediately if unavailable. The main agent must not invent a substitute role API. Kevin retains taste, credentials, physical actions and irreversible approvals.

## PR checklist

- What is the most important information on this surface? Which user decision does it support?
- What intent/state/goal/roadmap/priority evidence is used, and how old is it?
- What remains an inference or proxy? Is its label honest?
- What next action is visible, reversible and predictable? What does it explicitly not do?
- How does Kevin accept, reject, defer or correct it? Which stable feedback event learns from that response? If absent, say so.
- Does it reduce interruption and reuse the Needs Kevin queue rather than bypass it?
- What happens when the model, network, measurements or historical metadata are unavailable?
- What real test, timing trace and inspected render proves it? Are native claims supported by native evidence?
