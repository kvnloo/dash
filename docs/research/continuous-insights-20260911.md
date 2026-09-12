# Continuous R-phase insights — 2026-09-11 (wave 2)

Status: **working capture**. Same holding pen as [`competitors-100-20260911.md`](competitors-100-20260911.md). Not HOTL 0.3, not a paper. Cursor Task still **caps at 10** concurrent agents; this file is the join while the next ten run.

Loop: alias search (structure, not the token “AODL”) → 10-wide LLM overlay → human join → next wave. Do not remint \(\mathcal{O}_t\).

## Insight 1 — Declare vs recover (the missing dual)

The 100-target batch showed every *product* is a fragment or a runtime. The next-wave search found the **read-side** cousin:

[AgentFlow](https://arxiv.org/abs/2607.01640) (2026-07) recovers an **Agent Dependency Graph** from host-language + framework code (constructors, tool decorators, handoffs). Typed nodes: agents, prompts, models, capabilities, memory, control policies. Typed edges: component / control / data. Implemented on five frameworks; AgentZoo = 5,399 programs; 238 prompt-to-tool taints.

| Direction | Object | Owner |
|---|---|---|
| Write | declared \(\mathcal{O}^{\mathrm{intent}}\) | AODL document |
| Compile | plan this runtime will support | compiler profile |
| Recover | ADG from source | AgentFlow (static analysis) |
| Observe | receipts + events | `eventLog` / harness |

AODL writes the graph. AgentFlow reads a graph back out of LangGraph/CrewAI/… If recovered ADG ⊭ declared intent, **fail closed**. That is the three-object split as a *tool*, not a slogan. Do not import AgentFlow’s BOM as schema. Do not treat recovered ADG as observed \(\mathcal{O}_t\) (it is still code, not a run).

Catalog Readings one-liner: *AgentFlow is how you audit fragments; AODL is how you declare the graph those fragments already half-implement.*

## Insight 2 — Three calculi, one morphism (no new kinds)

Already in the first capture; restated as a check:

\[
v \;\mapsto\; \lambda_A\text{-term}, \qquad E_t \;\mapsto\; \text{global type (Scribble/MPST/Pact)}, \qquad \text{ports}(\lambda_A(v)) = \text{projection}(E_t)\restriction_v
\]

Disagreement \(\mapsto \bot\). NuScr / Scribble / ocaml-mpst are **compiler profiles on `message`**, not HOTL 0.3. Qoreo [2607.20391](https://arxiv.org/abs/2607.20391) and MAVLink rMPST [2501.18874](https://arxiv.org/abs/2501.18874) confirm the same shape in other domains: a global protocol excludes unsafe *sequences*, not just illegal messages.

## Insight 3 — Reasoning graphs ≠ orchestration graphs

[Graphs Meet AI Agents](https://arxiv.org/abs/2506.18019) taxonomizes ToT/GoT *reasoning* graphs with MAS *orchestration* graphs. Catalog copy must keep them apart. \(\mathcal{O}_t\) is not a chain-of-thought tree. Visual \(\tau\) must not compile a ToT silhouette into `fanout`.

## Insight 4 — Human attention already fits \(\Gamma_t\)

`constraints.budgets` is an open object. `humanGate` is already a node kind. Oversight inverted-U does **not** need a schema change: declare `constraints.budgets.humanAttention` (or equivalent name) and fail closed when C(RAID) D would exceed it. Flooding = budget exhaustion, not “ask more.”

## Insight 5 — What the 100 scanners actually proved

LLM min-effort agents over-skip anything that is not already typed \(\mathcal{O}_t\). That is the correct *IR* test and the wrong *readings* test. The join table is the filter: keep cousins as adapters/profiles; skip neutrinos and lead pipes; do not let SKIP eat \(\lambda_A\)/Pact/sheaves/RLM.

## This wave (10 agents, in flight)

Alias search (10 queries): AgentFlow ADG, Scribble/NuScr/ocaml-mpst, Cloudchor, Graphs-meet-agents. Blackboard-2026 query returned empty (codec miss, try stigmergy/tuplespace next).

Agents: AgentFlow paper, graphs-meet-agents, NuScr, Scribble, ocaml-mpst, Cloudchor, plus four reasoning cards (morphism, attention budget, slice experiment, catalog sheaf copy). Cards land in `/tmp/research/insights/` when they finish; this file stays the human join.

## Next (when slots free)

1. Stigmergy / tuplespace / blackboard aliases (query 06 died).
2. AgentZoo / AgentFlow implementation repo if public.
3. Slice-vs-dump experiment card → paper-gate #3, still unmeasured.
4. Catalog PER-1460: paste Readings (cousins + AgentFlow dual) and Adapters (MCP/A2A/AG-UI) — no schema change.
