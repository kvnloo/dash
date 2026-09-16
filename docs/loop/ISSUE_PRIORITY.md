# Issue Priority Rubric

> **Current backlog snapshot (2026-09-15, dash-issue-reprio)** — ranked by impact × effort toward the personalized compute mesh (phone + Tailscale + edge as compute; Expo↔mbp Tailscale `:4747`; hermes mesh bus; nvidia PAIR + Tailscale as first-class libs; keel production HOLD). NVIDIA PAIR ≠ dash phone pair.
>
> **Closed this cycle (shipped):** [#3](https://github.com/kvnloo/dash/issues/3) (PR #42), [#4](https://github.com/kvnloo/dash/issues/4) (PR #34), [#6](https://github.com/kvnloo/dash/issues/6) (PR #36), [#44](https://github.com/kvnloo/dash/issues/44) (PR #45). Earlier: #17, #43.
>
> | Rank | Issue | Pri | Notes |
> |------|-------|-----|-------|
> | 1 | [#8](https://github.com/kvnloo/dash/issues/8) Roster remaining chatable / non-static | P0 | claimable; partial on main |
> | 2 | [#20](https://github.com/kvnloo/dash/issues/20) Adopt live harness sessions | P0 | phone attach loop |
> | 3 | [#26](https://github.com/kvnloo/dash/issues/26) Live row shows transcript | P0 | |
> | 4 | [#28](https://github.com/kvnloo/dash/issues/28) Composer `/live` list + attach | P0 | |
> | 5 | [#10](https://github.com/kvnloo/dash/issues/10) Verification pyramid | P0 | pinned |
> | 6 | [#5](https://github.com/kvnloo/dash/issues/5) Tailscale auto-discover bridges | P1 | needs-discussion |
> | 7 | [#9](https://github.com/kvnloo/dash/issues/9) Hermes gateway A2A residual | P1 | claimable; mostly on main |
> | 8 | [#19](https://github.com/kvnloo/dash/issues/19) Orchestra AODL network | P1 | |
> | 9 | [#29](https://github.com/kvnloo/dash/issues/29) Default self-dev loop view | P1 | Kevin owns `app/` |
> | 10 | [#21](https://github.com/kvnloo/dash/issues/21) AODL `visual.json` cores | P1 | |
> | 11 | [#15](https://github.com/kvnloo/dash/issues/15) Ethos thin-UI docs | P1 | pinned; demoted from P0 |
> | 12 | [#11](https://github.com/kvnloo/dash/issues/11) Maestro nav-dot CI | P1 | claimable |
> | 13 | [#12](https://github.com/kvnloo/dash/issues/12) Expand mutation testing | P2 | claimable |
> | 14 | [#27](https://github.com/kvnloo/dash/issues/27) Thinking orbs / AODL animations | P2 | demoted from P0 (UI polish) |
>
> Stale `claimed` leases cleared this run. Re-rank quietly when unchanged next weekday.

## Priority Framework: Impact × Effort

**High Priority (P0):**

- **High impact, low effort.** Quick wins that unblock users or improve stability.
- Examples: Bug fixes, critical harness failures, WebSocket reconnect issues.

**Medium Priority (P1):**

- **High impact, medium effort.** Features or improvements that significantly advance the mesh vision.
- Examples: New harness support, multi-machine orchestration, Tailscale primitives.

**Low Priority (P2):**

- **Medium impact, low effort.** Nice-to-have improvements or polish.
- Examples: Better logging, example scripts, skill refinements.

**Backlog (P3):**

- **Low impact or high effort.** Future work that's not critical right now.
- Examples: Production deployment of keel, native modules outside Expo SDK, UI polish (Kevin is iterating).

## Priority Themes (2026 Roadmap)

These themes reflect current priorities toward the mesh vision:

### Theme 1: Bridge Stability (P0–P1)

**Goal:** Reliable WebSocket connection across network changes, screen locks, and harness failures.

**High-priority work:**

- Reconnect and replay correctness (ensure no events are lost on reattach).
- Graceful harness failures (non-zero exit, parse errors, timeout handling).
- Session management (multi-turn resumption, session pruning).

**Examples of issues:**

- "Live roster rows still not chatable / Cursor host empty" (P0) — see #8
- "Phone attach loses last buffered events on rare path" (P0 residual; core #3/#4 shipped)
- "Hermes CLI times out after 60s with no status" (P1)

### Theme 2: Harness Coverage (P1)

**Goal:** Support all major coding agents with clean, streaming output.

**High-priority work:**

- Add adapters for new agents (Aider, Sweep, Mentat, others).
- Improve streaming for existing harnesses (partial messages, tool status).
- Standardize output parsing (shared utilities for common formats).

**Examples of issues:**

- "Add support for Aider agent" (P1)
- "Codex adapter doesn't show tool execution status" (P1)
- "Grok streaming is choppy on slow networks" (P1)

### Theme 3: Community Tooling (P1–P2)

**Goal:** Make it easy for agents and humans to contribute cleanly.

**High-priority work:**

- Agent skills (short `SKILL.md` files teaching agents how to work with this repo).
- Contribution docs (search-first, fail-then-pass proofs, ownership rules).
- Examples and templates (conversation logs, integration tests).

**Examples of issues:**

- "Example: multi-turn conversation with session resume" (P2) — `dash-debug` shipped (#6 / PR #36)
- "Template: PR description for new harness" (P2)
- "Onboarding: search-first + fail-then-pass proofs" (P2)

### Theme 4: Mesh Primitives (P1–P2)

**Goal:** Tailscale integration, multi-machine orchestration, and edge compute.

**High-priority work:**

- Discover and register available machines on the tailnet (mesh directory).
- Route agent spawns to available compute (load balancing, affinity).
- NVIDIA PAIR (Personal-AI-Router): Integrate as a first-class mesh building block for home inference routing across devices. NVIDIA PAIR is distinct from Dash phone pairing; it's a separate mesh compute library alongside Tailscale.
- Edge compute integration (not yet unlocked; keel is internal scaffolding).

**Examples of issues:**

- "Auto-discover Tailscale machines running the bridge" (P1)
- "Spawn sub-agents on remote machines via Tailscale" (P1)
- "Document keel mesh architecture (design doc only)" (P2)

## What's NOT a Priority (For Now)

- **Production deployment of keel or backend services.** Keel is internal scaffolding and not ready.
- **Native modules outside Expo SDK.** Must run in Expo Go (no custom native code).
- **UI polish.** Kevin is actively iterating on `app/src/**`; avoid app UI changes unless assigned.

## How to Use This Rubric

**For maintainers:**

- Tag issues with `P0`, `P1`, `P2`, or `P3` based on impact and effort.
- Focus reviews on P0/P1 work first.
- Close or defer P3 issues that don't align with the vision.

**For contributors:**

- Check issue labels and priority tags before starting work.
- Open a discussion for large P1/P2 work to align on approach.
- P0 bug fixes can skip discussion (but include a reproduction case).

**For agents:**

- Read `.cursor/skills/dash-onboard/SKILL.md` to understand priorities before opening PRs.
- Prioritize P0/P1 work over P2/P3 polish.
- Ask in discussions if you're unsure about priority.

## Example Priority Assignments

| Issue | Theme | Impact | Effort | Priority |
|-------|-------|--------|--------|----------|
| WebSocket drops events on reconnect | Bridge Stability | High | Low | P0 |
| Add support for Aider agent | Harness Coverage | High | Medium | P1 |
| Improve bridge logging | Community Tooling | Medium | Low | P2 |
| Deploy keel to production | Mesh Primitives | Low (not ready) | High | P3 |

## Questions?

Open a discussion or issue in the repo. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.
