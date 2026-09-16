# AgentFlow (arXiv:2607.01640) vs AODL — deep read

**Source:** Wang et al., *AgentFlow: Building Agent Dependency Graphs for Static Analysis of Agent Programs* (full text via [ar5iv 2607.01640](https://ar5iv.labs.arxiv.org/html/2607.01640), ~100KB markdown fetch 2026-09-12).

**AODL anchor (unchanged):** \(\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\). Three objects, never substituted: **intent** \(\neq\) compiled **plan** \(\neq\) **observed** \(\mathcal{O}_t\). Fail closed. AgentFlow is **read-side audit**: it recovers an Agent Dependency Graph (ADG) from host-language + framework source; it is not a substitute for declared intent or runtime observation.

**Name collision:** GitHub `agentenv/agentflow` is a graph *orchestrator*, not Wang et al. ADG recovery.

---

## 1. ADG node types vs AODL node kinds

AgentFlow’s shared node set \(V\) is drawn from \(\mathcal{V} = \mathcal{A} \uplus \mathcal{I} \uplus \mathcal{M} \uplus \mathcal{C} \uplus \mathcal{S} \uplus \mathcal{G}\) (agent units, prompt contexts, model units, capabilities, memory states, control policies). Entity facts (`AgentDef`, `ToolDef`, `MCPDef`, …) materialize these at extraction time.

AODL \(V_t\) is a finite set of **typed orchestration nodes** from a closed kind enum (HOTL catalog: harness/agent roles, `humanGate`, `stateStore` / `blackboard`, tool ports, observation sinks, C(RAID) hybrids via `policies.kinds`, etc.). Labs (skills, MCP servers, Crew roles) are **instances or compiler profiles**, not ad hoc kinds.

| ADG domain / node role | AgentFlow meaning | AODL kind / reading | Alignment notes |
|---|---|---|---|
| \(\mathcal{A}\) — agent unit | Framework `Agent(...)`, crew role, graph node with bound components | Agent / harness node (orchestration actor with ports \(P(v)\)) | Same *slot*: an autonomous step with inbound/outbound ports. AODL separates **who may act** (authority, spawn bounds) in \(\Gamma_t\); ADG does not. |
| \(\mathcal{I}\) — prompt / instruction context | System/user instructions bound to an agent | Usually **embedded** in agent intent text or profile, not a standalone kind | ADG lifts prompts to first-class nodes for **data-flow**; AODL treats prompt *content* as document/intent, flow as `message` / observation edges. |
| \(\mathcal{M}\) — model unit | LLM id / routing target bound to an agent | Model choice in node metadata or \(\Pi_t\) router outcome | ADG inventories models per agent (BOM); AODL puts nondeterministic model choice under \(\Pi_t\), not a separate vertex unless explicitly modeled. |
| \(\mathcal{C}\) — capability | Tools, MCP, skills, hosted capabilities | `tool` / `service` port (MCP/A2A are transports on those edges) | Strong match. Agent Skills are procedures on tools, not kinds. |
| \(\mathcal{S}\) — memory / state | Shared session, checkpoint, framework state object | `stateStore`, `blackboard`, `observation` readings of \(S_t\) | ADG models read/write **ADFG** paths \(a \to s \to a'\); AODL marks shared state explicitly and governs **classified reads** in \(\Gamma_t\). |
| \(\mathcal{G}\) — control policy | Approval policies, guards, `BranchIf` on calls | `humanGate`, budgets in \(\Gamma_t\), edge classification on `message` | ADG policies are **ACFG** intermediates; AODL gates are declared nodes + \(\Gamma\) budgets (e.g. human-attention), not recovered AST facts. |
| *(none)* — host code | Ordinary Python/TS functions inside tool bodies | Out of \(V_t\); verifier / lower analysis | Paper: ADG is high-level framework semantics; tool **implementations** need points-to/taint pairing. |
| *(none)* — marketplace / router | Dynamic next-agent enumeration | \(\Pi_t\) (auction, router, C(RAID) hybrid) | ADG over-approximates possible routes; AODL declares policy separately from \(V_t\). |
| *(none)* — event log / receipt | Not in ADG | Observed layer: `eventLog`, harness receipts | Defines **observed** \(\mathcal{O}_t\), not static recovery. |

**Takeaway:** ADG’s six domains are a **dependency-centric projection** of what AODL already splits across \(V_t\), \(S_t\), and \(\Pi_t\). Mapping is many-to-one onto AODL kinds plus readings; the important gap is **policy and observation**, which ADG only partially encodes as \(\mathcal{G}\) and never as runtime state.

---

## 2. ADG edge types vs AODL relations

\(\mathsf{ADG}_P = \langle \mathsf{ACDG}_P, \mathsf{ACFG}_P, \mathsf{ADFG}_P \rangle\) with shared \(V\).

| ADG subgraph | Edge shape | Semantics (AgentFlow) | AODL relation \(R\) / pattern |
|---|---|---|---|
| **ACDG** | Undirected \(\{a,x\}\), \(\{g,x\}\), \(\{a_1,a_2\}\) | Static **component binding**: agent↔prompt/model/capability/state; policy↔agent/capability; agent↔agent association | Structural **compile witness** (ports, deps, bindings in compiled plan), not a runtime edge kind. Intent document lists allowed bindings; fail closed if compile ≠ intent. |
| **ACFG** | Directed from \(T_{\mathsf{acfg}} \subseteq \mathcal{A} \times (\mathcal{G} \cup \{\bot\}) \times (\mathcal{A} \cup \mathcal{C})\) | **May invoke** tool; **transfer** / handoff agent→agent; guarded paths via policy nodes | `sequence`, `fanout`, `message` / `delegation`, tool invocation skeleton; `humanGate` on guarded branches. Session-type profile checks **legal traces**, not just edge presence. |
| **ADFG** | \(E^{\mathsf{ctx}}_{\mathcal{I}\to\mathcal{A}}\), \(E^{\mathsf{arg}}_{\mathcal{A}\to\mathcal{C}}\), \(E^{\mathsf{ret}}_{\mathcal{C}\to\mathcal{A}}\), \(E^{\mathsf{msg}}_{\mathcal{A}\to\mathcal{A}}\), \(E^{\mathsf{write/read}}_{\mathcal{A}\leftrightarrow\mathcal{S}}\) | Possible **information propagation** (prompt→agent, args/returns, inter-agent messages, shared state) | Classified **data/control** on existing edges: IFC/quorum on `message`, governance on `stateStore` reads, observation edges for receipts. Taint is a **query** over this skeleton, not a new relation. |

AgentFlow reachability notations: \(\leadsto_{\mathsf{str}}\) (ACDG), \(\leadsto_{\mathsf{ctrl}}\) (ACFG), \(\leadsto_{\mathsf{data}}\) (ADFG, transitive).

AODL \(E_t \subseteq V_t \times R \times V_t\) with **directed typed multigraph** edges. ADG’s undirected ACDG has no direct edge label; it corresponds to “**statically associated**” in intent/plan, while ACFG/ADFG align with control + data annotations on orchestration relations.

---

## 3. What Agent BOM and prompt-to-tool taint find — and what \(\Gamma_t\) must **declare**

AgentFlow does not replace \(\Gamma_t\); it shows which **governance fields** must be explicit so audit queries do not become implicit allow-lists.

### Agent BOM query

\[
\mathsf{BOM}(P) = \{(a,x) \mid a \in \mathcal{A},\ x \in \mathcal{I}\cup\mathcal{M}\cup\mathcal{C}\cup\mathcal{S}\cup\mathcal{A},\ a \leadsto_{\mathsf{str}} x\}
\]

**Finds:** For each agent, which prompts, models, capabilities, memory objects, and peer agents are **structurally bound** in source (dependency-aware inventory vs package-only AI-BOM).

**\(\Gamma_t\) should declare (fail closed if code recovers more):**

- Per-agent **allowlists** for invokable tools/services and attached MCP/skills (supply-chain surface).
- **Model / prompt attachment** policy: which model ids and instruction sources are authorized for which roles.
- **Memory sharing rules**: which agents may read/write which `stateStore` / blackboard partitions (maps to ADFG write/read paths).
- **Inter-agent coupling**: which handoffs/delegations are permitted (ACDG agent↔agent + ACFG transfers).
- **Human/policy gates** on high-impact capabilities (maps to \(\mathcal{G}\) on approval-wrapped calls)—who must approve before `Call(a,c)`.

Paper motivation: Agent BOMs must capture not only components but **binding relationships**; inventory without edges is insufficient for threat modeling.

### Prompt-to-tool (P2T) taint query

Definitions: \(\mathsf{Src}_{\mathsf{prompt}} \subseteq \mathcal{I}\), \(\mathsf{Snk}_{\mathsf{tool}} \subseteq \mathcal{C}\) (sensitive sinks), \(E_{\mathsf{arg}}\) = agent→capability argument flow.

\[
\mathsf{P2T}(P) = \{(p,a,c) \mid (p,a)\in R_{\mathsf{pa}},\ (a,c)\in R_{\mathsf{ac}},\ (a,c)\in E_{\mathsf{arg}}\}
\]

with \(R_{\mathsf{pa}}\): prompt \(\leadsto_{\mathsf{data}}\) agent; \(R_{\mathsf{ac}}\): agent \(\leadsto_{\mathsf{ctrl}}\) sensitive capability.

**Finds:** Triples where **prompt-influenced data** may reach **arguments** of a **privileged** capability under combined data + control flow (238 hits on AgentZoo; 73% precision on manual audit—many FPs are **sink semantics**, not wrong ADG edges).

**\(\Gamma_t\) should declare:**

- **`Src_prompt` classification**: which inputs are untrusted / user-controlled vs system-fixed.
- **`Snk_tool` taxonomy**: sensitive capabilities with **effect modes** (read-only SQL vs write, file read vs delete, calculator vs exec)—paper notes FPs from coarse sinks.
- **Required guards**: paths that demand `humanGate` or deny P2T unless approval policy node sits on ACFG path.
- **Budgets**: human-attention and escalation limits (Oversight inverted-U)—flooding attacks exhaust \(\Gamma\) budget, not “more review.”
- **Information-classification on edges**: which `message` / `stateStore` reads may inject into tool args (IFC/profile on sends).

BOM answers “**what is wired**”; P2T answers “**what untrusted flow the wiring permits**.” Both are **queries over recovered structure**; \(\Gamma_t\) is where the organization **states what is allowed** so recovery can be checked fail-closed.

---

## 4. Why recovered ADG is **not** observed \(\mathcal{O}_t\)

1. **Artifact class:** ADG is extracted from **source code + framework semantics**, not from telemetry, PROV, OTel, or Dash harness **receipts**. AODL observed \(\mathcal{O}_t\) is event log + evidence that a particular run happened.

2. **Over-approximation:** AgentFlow is explicit: static analysis captures dependencies **permitted** by program structure and framework APIs, **not** a single execution trace. LLM choices, dynamic routing, and runtime tool binding can shrink actual behavior; ADG **enlarges** it.

3. **Nondeterminism:** “Concrete behavior may depend on runtime model outputs”; ADG does not predict one path—it summarizes **possible** ACFG/ADFG paths.

4. **Incomplete recovery:** Evaluation notes false negatives from custom wrappers, dynamic tool binding, LangGraph-specific bindings—so even as a **plan/code** artifact, ADG can miss edges the run later exhibits.

5. **Three-object discipline:** Recovered ADG is closest to “**what the repo implements**,” comparable to a **compiled plan fragment** or audit overlay—not intent (declared \(\mathcal{O}^{\mathrm{intent}}\)) and not observed (receipts). Treating ADG as observed \(\mathcal{O}_t\) collapses intent/plan/observed and breaks fail-closed governance.

6. **No \(\Pi_t\) or \(S_t\) marking:** ADG does not encode auction outcomes, router draws, token budgets, or Petri/markings—only static **may** relations.

**Catalog line:** AgentFlow reads a graph **out of** LangGraph/CrewAI/OpenAI SDK/etc.; AODL **writes** the graph you intend. Recovery informs audit; it does not substitute observation.

---

## 5. One fail-closed check: **ADG ⊭ intent**

**Setting:** Declared intent document \(\mathcal{O}^{\mathrm{intent}}_t = (V^{\mathrm{int}}, E^{\mathrm{int}}, \ldots, \Gamma^{\mathrm{int}})\). Implementation source \(P\) yields recovered \(\widehat{\mathsf{ADG}}_P\) via AgentFlow (or equivalent static extractor).

**Judgment:** Intent **does not model** recovery (written ADG ⊭ intent) when any of the following hold; pipeline **stops** (\(\bot\)), no silent widen:

| Violation | Example |
|---|---|
| **Extra capability edge** | \(\exists (a,c)\): \(\widehat{\mathsf{ADG}}\) has ACFG or ACDG bind to \(c\), but \(\Gamma^{\mathrm{int}}\) / intent allowlist has no authorized `tool`/`service` for agent \(a\). |
| **Extra data path** | \(\exists\) P2T-class triple \((p,a,c)\) in \(\widehat{\mathsf{P2T}}(P)\) but intent declares no classified path from prompt sources to \(c\)’s args (IFC deny). |
| **Missing mandatory gate** | Intent requires `humanGate` on \(a \to c\); \(\widehat{\mathsf{ADG}}\) has unguarded `Call(a,c)` (no \(\mathcal{G}\) on ACFG path). |
| **Port / binding mismatch** | Compiler witness \(\pi_v\): declared port multiset on node \(v\) ≠ ports implied by ACDG bindings ( \(\lambda_A\) / MPST-style triple mismatch \(\mapsto \bot\)). |
| **Spawn / delegation overreach** | Recovered ACFG agent→agent transfers exceed intent’s declared `message`/`delegation` or C(RAID) fanout bounds. |

**Operational rule (from Dash research join):** Run AgentFlow (or cousin: Agent-Wiz, Agentic Radar) on the **same** codebase that implements intent; if recovered dependencies **imply** behaviors not **entailed** by declared intent + \(\Gamma_t\), **fail closed**—do not promote recovery to observed \(\mathcal{O}_t\), do not import AgentFlow’s BOM JSON as AODL schema.

**Contrast:** ADG ⊭ intent is **audit failure** (implementation richer or different than declaration). Observed vs intent is a **separate** check (receipts vs declaration). Plan vs intent is compiler output vs declaration. Keep all three distinct.

---

## References in-repo

- [`docs/research/continuous-insights-20260911.md`](https://github.com/kvnloo/dash/blob/main/docs/research/continuous-insights-20260911.md) — AgentFlow as read-side dual; ADG ⊭ intent fail-closed.
- [`docs/research/aodl-craid-20260911.md`](https://github.com/kvnloo/dash/blob/main/docs/research/aodl-craid-20260911.md) — \(\mathcal{O}_t\) definition, three objects, \(\Gamma_t\) readings.

**Raw paper cache:** `/tmp/research/deep/agentflow_raw.txt`
