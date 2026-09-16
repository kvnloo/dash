---
id: perm-20260911-control-plane-is-not-an-executor
title: The GUI over a coding agent is not a second agent
type: permanent
status: draft
created: 2026-09-11
updated: 2026-09-11
harnesses: [omp, hermes, o8, grok, claude, codex]
domains: [frameworks, tool-use]
confidence: high
tags: [permanent, dash, aodl]
---

# The GUI over a coding agent is not a second agent

## Idea (atomic)

T3 Code, Conductor, o8, and Dash are control planes. They spawn or attach to catalog executors. They must not mint a parallel empty thread when a live session already exists. AODL encodes this as `kind: executor` vs `kind: control-room` / `distro`. Unknown ids fail closed.

## Why it matters for our harnesses

OMP live tabs, Hermes gateway profiles, and Grok-bot rows are the session. Dash Chats should adopt them (`sessionId` from the harness). o8 and firstmate stay off `hello.harnesses`. Frontier harness notes should tag UI surfaces separately from CLI capabilities.

## Related

- [[harnesses/omp]]
- [[harnesses/o8]]
- [[harnesses/hermes]]
- AODL `harnesses/catalog.json`
- Dash issues #15, #20, #26, #28
