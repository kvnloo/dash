# C(RAID) R-phase — 2026-09-11

Status: **working capture** in Dash because this cloud token cannot push [kvnloo/aodl](https://github.com/kvnloo/aodl) or [kvnloo/frontier-kb](https://github.com/kvnloo/frontier-kb) (403). Canonical homes remain those repos. This file is not HOTL schema, not a Dash UI change, not a preprint.

C(RAID) = Continuous Research → Analysis → Integration → Deployment ([aodl `spec/craid.md`](https://github.com/kvnloo/aodl/blob/main/spec/craid.md)). This pass is **R**. Machine contract: aodl `schema/` + `tests/validate.py`. Human contract: [aodl `docs/working-note.md`](https://github.com/kvnloo/aodl/blob/main/docs/working-note.md). Dash `/roster` and Orchestra are observed $V$, not $\mathcal{O}_t$.

Search method: **DuckDuckGo** via `ddgs` plus **agent-reach** Jina Reader (`curl https://r.jina.ai/URL`), `gh`, arXiv `id_list`. Tavily was down. Native `ddgs` backend `duckduckgo` returned empty from this IP (html.duckduckgo.com/lite served an anomaly interstitial). `ddgs text -b auto` / `brave` (the DDGS client) returned **398 hits / 50 alias queries / 395 unique URLs / 58 arXiv ids**. Primaries were read through Jina, not title-skimmed.

## 1. Meta-strategy: language as substrate

Labels are a lossy codec. The same computational structure is sold as swarm, mesh, crew, huddle, factory, hive, marketplace, supervisor, digital twin, orchestrator, harness, skill, protocol, graph.

Information-theoretically: maximize coverage of the **concept**, not the **token**. Query by invariants (ports, authority, bounded mutation, evidence, human gates, three-object split) and by aliases that hide them.

| What we mean | Labels that hide it |
|---|---|
| typed graph IR | workflow, DAG, LangGraph, vibe graphing, orchestra pane |
| message protocol | A2A, FIPA ACL, session types, choreography, MCP (wrong layer) |
| tool ports | MCP, function calling, skills, plugins |
| user surface | AG-UI, A2UI, Dash, Solarpunk cores |
| allocation policy | marketplace, auction, contract net, Agora |
| shared state | blackboard, CRDT, tuplespace, stigmergy, memory |
| human gate | HITL, HOTL, Keel L0, captain-hold, interrupt() |
| bounded spawn | AgentSpawn, recursion, swarm, maxChildren |
| observed vs intended | traces, OTel, PROV, event sourcing, receipts |
| context compression | RLM, compaction, rate-distortion, graph slice |

Search that only uses “AODL” or “orchestration language” misses $\lambda_A$, Pact, sheaves, MPST, CodeCRDT. Search that only uses those names misses AODL. The join is this file.

## 2. What AODL already is (do not remint)

$$
\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)
$$

Three objects, never substituted: intent $\neq$ compiled plan $\neq$ observed $\mathcal{O}_t$. Fail closed. Marketplace is $\Pi_t$, not a product. C(RAID) is a named hybrid of existing kinds. Visual $\tau$ is a decoder.

The honest candidate for a later paper is still a **conservative interchange**, not a new scheduler. That sentence from the AODL working note survived this literature pass.

## 3. Closest cutting-edge (read, not skimmed)

| Source | What it is | Maps onto | Do not import |
|---|---|---|---|
| [2604.11767](https://arxiv.org/abs/2604.11767) $\lambda_A$ | typed $\lambda$-calculus: oracle, bounded fix, probabilistic choice, env. Coq 42/42. 94.1% of 835 GitHub agent configs structurally incomplete. LangGraph/CrewAI/AutoGen/OpenAI SDK/Dify embed as fragments. | single-node operational semantics; `fix_n` = AODL bounded recursion; missing terminate tool = unbounded-spawn fail-closed | replacing HOTL 0.2 with a lambda; YAML lint as authority |
| [2605.03143](https://arxiv.org/abs/2605.03143) Pact | choreography + choices + utilities + nature vars $\mapsto$ a game. Deadlock-free projection. Why an agent follows a protocol. | `message`/`delegation` edges as global type; auction $\Pi_t$ as the game reading | payment execution; assuming cooperative participants |
| [2510.24205](https://arxiv.org/abs/2510.24205) CoMPSeT | compare multiparty session types; global type $\to$ local projection | optional session-type profile on `message` edges | picking one MPST dialect as the IR |
| [2603.06007](https://arxiv.org/abs/2603.06007) MASFactory | graph IR + Vibe Graphing (NL $\to$ editable spec $\to$ executable). Control / message / state flows. HITL Interaction node. | AODL’s three-object + data/control split; visualizer is $\tau$, not the language | treating NL-compiled graphs as observed $\mathcal{O}_t$ |
| [2602.16873](https://arxiv.org/abs/2602.16873) AdaptOrch | after model-quality convergence, **topology** dominates; four canonical topologies + $O(\|V\|+\|E\|)$ router | $\Pi_t$ selection over AODL programs; “hybrid” must stay named | inferring swarm from a silhouette |
| [2602.07072](https://arxiv.org/abs/2602.07072) AgentSpawn | runtime spawn with memory slice + coherence protocol | bounded `maxChildren` / reserved budget; spawn is graph mutation | unbounded spawn |
| [2605.01879](https://arxiv.org/abs/2605.01879) STP | time-as-site, sheaves $\mathcal{F}_{World}$, $\mathcal{F}_{Mem}$, $\mathcal{F}_{Goal}$; actions = natural transformations; abduction = pullback; swarm consensus = gluing; conflict = obstruction | geometric reading of intent / plan / observed; fail-closed as obstruction | putting a topos in `schema/` |
| [2510.18893](https://arxiv.org/abs/2510.18893) CodeCRDT | observe shared CRDT instead of message-passing; 100% character merge, 5–10% **semantic** conflicts | `observation` + `stateStore`; verifier independence is mandatory | treating CRDT convergence as verification |
| [2512.24601](https://arxiv.org/abs/2512.24601) RLM | prompt lives in the environment; recursive self-calls over slices | token-slice hypothesis in HOTL 0.2; `memory` node is not the context window | claiming RLM proves dynamic-graph interchange |
| [2608.09096](https://arxiv.org/abs/2608.09096) Evo-Bench | evolver $E$ edits harness $H_t$ under budget; early saturation; harnesses transfer across policy models | architecture search = search over AODL programs; $H_t$ is compiled $\Pi$ | evolving AODL schema from a benchmark score |
| [2606.19812](https://arxiv.org/abs/2606.19812) HOTL legal | trajectory collapse; four verification layers; calibrated escalation | `humanGate` + evidence; intercept at planning/reasoning/execution, not only endpoint F1 | renaming Keel |
| [2606.08919](https://arxiv.org/abs/2606.08919) Oversight capacity | inverted-U: more escalation can be less safe; human attention is a budget; flooding attack | $\Gamma_t$ already has budgets; add **human-attention** as a first-class declared budget | escalate-everything as C(RAID) D |
| [2601.13671](https://arxiv.org/abs/2601.13671) MAS orchestration survey | MCP = tools, A2A = peers, orchestration = control plane | confirms protocol $\neq$ IR | enterprise “Agent OS” as a second scheduler |
| OpenAI [harness engineering](https://openai.com/index/harness-engineering/) | humans specify intent + feedback loops; repo is system of record; AGENTS.md is a TOC; mechanical invariants | observed $V$ vs intent; compile AODL $\to$ repo laws, not the reverse | 0-lines-human as a Dash requirement |
| [AG-UI](https://docs.ag-ui.com/introduction) / [A2UI](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) / [MCP](https://modelcontextprotocol.io/specification/2026-07-28) / [A2A](https://a2a-protocol.org/latest/specification/) | three **protocol** layers: user, tools, peers | adapters under AODL, never replacements | collapsing MCP into $\mathcal{O}_t$ |

Also pulled (abstracts; see arXiv): Agent Skills survey [2602.12430](https://arxiv.org/abs/2602.12430), OpenHands SDK [2511.03690](https://arxiv.org/abs/2511.03690), Live-SWE-agent [2511.13646](https://arxiv.org/abs/2511.13646), evidence-tracing survey [2606.04990](https://arxiv.org/abs/2606.04990), semantic rate-distortion [2604.09521](https://arxiv.org/abs/2604.09521), memory compaction RD [2607.08032](https://arxiv.org/abs/2607.08032), Agora auctions [2607.09600](https://arxiv.org/abs/2607.09600), Evolving Orchestration [2505.19591](https://arxiv.org/abs/2505.19591), blackboard MAS [2510.01285](https://arxiv.org/abs/2510.01285).

## 4. Formal language, from first principles

Keep $\mathcal{O}_t$. Add **readings**, not new kinds, until a compiler dry-run exists.

### 4.1 Set theory (already)

$V_t$ is a finite set of typed nodes. $E_t \subseteq V_t \times R \times V_t$ with relation $R$ drawn from a closed enum. Ports are functions $P: V_t \to \mathrm{FinSet}$. Fan-in is an explicit reducer, not an implicit join. This is a typed directed multigraph, not a property graph with “maybe swarm.”

### 4.2 Process / types (next profile)

A `message` edge is a **session**, not a pipe. Global type (choreography / MPST) projects to local types per node. Duality: every send has a receive, or compilation is $\bot$. Pact adds a game: choices, utilities, nature. AODL auction $\Pi_t$ is already that shape with payment execution forbidden. Session types are how we would *check* the message skeleton; they are not a silhouette.

$\lambda_A$ is the **intra-node** calculus (oracle + `fix_n`). AODL is the **inter-node** graph. Composition:

$$
\text{node } v \text{ compiles to a } \lambda_A \text{ term}; \quad E_t \text{ compiles to a global type}.
$$

If those two compilations disagree on ports, fail closed. That is the $\lambda_A$ finding (94% incomplete configs) stated in HOTL language.

### 4.3 States, networks, physics (reading)

$S_t$ is a marking (Petri), a configuration (actors), or a sheaf section (STP). Prefer the sheaf reading for the three objects:

| Sheaf | AODL object |
|---|---|
| $\mathcal{F}_{\mathrm{intent}}$ | document |
| $\mathcal{F}_{\mathrm{plan}}$ | compiler profile |
| $\mathcal{F}_{\mathrm{obs}}$ | event log + receipts |

Gluing compatible local observations $\mapsto$ one observed $\mathcal{O}_t$. Obstruction $\mapsto$ fail closed or abduct (verifier), never invent an edge. Actions as natural transformations $\mapsto$ authorized mutations $C \xrightarrow{a} C'$.

Do not put Grothendieck topologies in JSON. Put the reading here so a visual twin does not invent a fourth object called “the field.”

### 4.4 Statistics / control / RL

Nondeterministic $\Pi_t$ (router, auction, model output) is a policy over a typed MDP whose state is the graph. DEC-POMDP is the multi-agent version: partial observation is information classification on edges. AdaptOrch’s claim (topology $>$ model once quality converges) is an empirical hypothesis for architecture search over AODL programs. Evo-Bench already writes $A_t = (\pi, H_t)$. $H_t$ should be a compiled plan, not an English topology name.

### 4.5 Information theory (this search, and the slice claim)

Rate-distortion: tokens are rate; missed dependencies / stale state are distortion. RLM treats the prompt as an external object; AODL should treat $\mathcal{O}_t$ the same way — query slices, do not dump. Semantic rate-distortion ([2604.09521](https://arxiv.org/abs/2604.09521)) and memory compaction ([2607.08032](https://arxiv.org/abs/2607.08032)) are the same claim with different labels.

Alias search is also RD: each extra query spends rate to reduce distortion (missed equivalent literature).

### 4.6 Consciousness / philosophy (discipline, not cargo)

Useful, not literal:

- Global workspace $\approx$ a declared `blackboard` / `stateStore` with classified writes. Not a silhouette named “consciousness.”
- Active inference $\approx$ $\Gamma_t$ as expected free energy: goals + budgets + surprise from `observation` edges ([2604.12657](https://arxiv.org/abs/2604.12657)).
- Collective intentionality $\approx$ shared $\Gamma_t$ with humanGate; Keel L0 is “the router is not an agent of the project.”
- IIT $\Phi$ is **not** an AODL field. Do not infer intelligence from graph density.

### 4.7 Labs as instances, not kinds

Cursor background agents, Claude Code skills, Codex harness engineering, Hermes Kanban/A2A, OMP, OpenHands SDK: each is a **compiler profile** or an **observed** $V$. Agent Skills ([agentskills.io](https://agentskills.io/)) are packaged procedures, not node kinds. MCP/A2A/AG-UI are transports + schemas for three edges AODL already has (`tool`/`service`, `message`/`delegation`, visual $\tau$).

The language improvement is: **one IR that those systems already implement under other names**, with fail-closed holes where they don’t (authority depth, bounded spawn, evidence, human-attention budget).

## 5. How to push the paradigm (ordered)

Still blocked on AODL’s three paper gates (Hermes dry-run, Keel profile, one measured claim). This list is the R-phase backlog, not HOTL 0.3.

1. **Keep the interchange conservative.** Adapter profiles: $\lambda_A$ (intra-node), MPST/Pact (message), MCP (tools), A2A (peers), AG-UI/A2UI (user), OpenTelemetry/PROV (observed). Unsupported fields stop compilation.
2. **Name human attention in $\Gamma_t$.** Oversight inverted-U. C(RAID) D is a `humanGate` with a budget, not “ask more.”
3. **Treat spawn as mutation with a coherence protocol.** AgentSpawn + CodeCRDT: observation-driven, then a **verifier** for semantic conflicts. Character-level CRDT is not verification.
4. **Architecture search over programs.** Evo-Bench $H_t$ + AdaptOrch topologies = search in the space of valid AODL documents. Early saturation is a warning against unbounded self-edit of the IR.
5. **Measure the slice claim.** RLM + RD papers exist; AODL still needs the token-slice vs dump benchmark named in 0.2.
6. **Optional session-type profile.** `message` edges may carry a global type. Missing type is unspecified, not inferred. Duality failures are $\bot$.
7. **Sheaf reading in the AODL catalog UI.** Explain intent/plan/observed as non-glueable until receipts exist. Do not add sheaf fields.
8. **C(RAID) stays the named hybrid** for this factory. New hybrids need `policies.kinds` + fixtures in aodl, same as today.

## 6. Work with frontier-kb and Dash

Promote this file to:

- aodl `docs/research-craid-20260911.md` + a pointer in `docs/working-note.md`
- frontier-kb `inbox/cursor/` (distributed-writer rule; CoS promotes literature/permanent)

Do not vendor AODL schema into Dash. Orchestra / Bots remain projections of observed $V$ and the [harness catalog](https://github.com/kvnloo/aodl/blob/main/harnesses/catalog.json). Frontier-kb Postgres CAS is the operational note store; this markdown is review export.

## 7. Non-goals (reaffirmed)

No arXiv from this tree. No AODL `.tex`. No second scheduler in Dash. No payment. No inferred swarm. No claiming $\lambda_A$ or Pact as AODL 0.3. No `app/` or `bridge/` edits in this pass.

Proof of “did not change the language”: this PR adds docs only. AODL `python3 tests/validate.py` was green on a local clone (`6 valid, 11 invalid`) and was not modified in a way this token could publish.
