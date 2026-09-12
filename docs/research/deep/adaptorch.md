# AdaptOrch (arXiv:2602.16873) — deep read for AODL

**Source:** full text from arXiv LaTeX source (`main.tex`, Feb 2026). Jina reader (`r.jina.ai`) did not return body text in this environment (Cloudflare / 500); content below is grounded in the paper, not in secondary summaries.

**Paper thesis:** Under **ε-convergence** of frontier LLM scores on a benchmark, **orchestration topology** (how subtasks are scheduled, coupled, and synthesized) can dominate **which model** is picked. AdaptOrch automates **topology selection** from a task dependency DAG \(G_T = (V,E,w,c)\) via structural features and a linear-time router.

---

## 1. Four canonical topologies vs `policies.kinds` / silhouettes

### What AdaptOrch names (closed set \(\mathcal{T}\))

| Symbol | Name | Operational meaning (paper) | Router trigger (Algorithm 1, sketch) |
|--------|------|-----------------------------|--------------------------------------|
| \(\tau_P\) | **Parallel** | All subtasks run concurrently; outputs merged post-hoc | \(|E|=0\) or wide DAG, low coupling \(\gamma\) |
| \(\tau_S\) | **Sequential** | Topological order; each step gets predecessor context | \(\omega(G_T)=1\) (no antichain width) |
| \(\tau_H\) | **Hierarchical** | Lead agent decomposes, assigns, monitors, reconciles | High \(\gamma\) and \(|V|>\theta_\delta\) |
| \(\tau_X\) | **Hybrid** | Topological **layers**: parallel inside a layer, sequential across layers | Default when neither pure P/S/H fits |

Features driving the router (not decorative):

- **Parallelism width** \(\omega(G_T)\) — max antichain size (approximated by max layer width in \(O(|V|+|E|)\) for routing).
- **Critical path depth** \(\delta(G_T)\) — longest weighted path.
- **Coupling density** \(\gamma(G_T)\) — mean edge coupling \(c(u,v)\in\{0,0.3,0.7,1.0\}\) from decomposer labels (none / weak / strong / critical).

Empirically, **\(\tau_X\) is chosen ~50%** of the time (SWE-bench 62%, HotpotQA 71%); pure sequential dominates high-coupling GPQA, not “swarm.”

### AODL side (intent IR, not AdaptOrch’s runtime)

AODL expresses orchestration in **declared** graph metadata:

- **Control skeleton:** closed relation enum on edges — e.g. compile-facing **`sequence`**, **`fanout`**, **`retry`** (plus message/tool/service edges, reducers, classified state).
- **`policies.kinds`:** names **policy classes** (including **`hybrid`**) that must appear in the document with fixtures; they are not inferred from geometry alone.
- **Silhouettes (\(\tau\) visualizer, Crew/LangGraph canvases, TikZ, “hive” icons):** lossy **decoders** of metadata. Catalog rule: \(\tau\) **must not** compile a drawing into control kind without declared fields (e.g. ToT reasoning trees → **`fanout`** is forbidden).

### Alignment map (conservative — no new kinds)

| AdaptOrch topology | AODL reading | Silhouette trap |
|--------------------|--------------|-----------------|
| \(\tau_S\) Sequential | **`sequence`** on the subtask DAG (topological control flow) | A left-to-right chain in a UI is **`sequence`**, not “pipeline” as an unnamed hybrid |
| \(\tau_P\) Parallel | **`fanout`** over an antichain / independent subtasks + explicit merge/synthesis node | “Many agents at once” in a figure is **`fanout`** only if reducers and deps are declared — not **`swarm`** |
| \(\tau_H\) Hierarchical | **Delegation / lead–sub** pattern: often **`message`** + supervisor-shaped \(V\), high \(\gamma\) routing in AdaptOrch — maps to **named** policy + graph, not a fifth kind | Star/spoke drawings resemble “orchestrator” products; that is **not** `policies.kinds: swarm` |
| \(\tau_X\) Hybrid | **`hybrid`** in **`policies.kinds`** + **`fanout` within layer** and **`sequence` across layers** (stage graph) | Diamond / fan-out–fan-in DAG shape (paper’s “Diamond” cluster) is **\(\tau_X\)**, not swarm; stage partition must be **written**, not read off the picture |

**What AdaptOrch does *not* give you:** a fifth canonical label “swarm,” “mesh,” or “crew.” CrewAI-style role teams are **static** in the related-work critique — AODL treats **Crew-shaped graphs as unlabeled hybrid until `policies.kinds` says otherwise** (see §3).

**Router vs compiler:** AdaptOrch’s Algorithm 1 is a **\(\Pi_t\)-style selector** over four **templates** given \(G_T\). In AODL terms, that is **search/selection in the space of valid programs** whose **control + `policies.kinds`** realize one of those templates — not a license to add kinds or to treat \(S_t\) (observation / blackboard readings) as a topology kind.

---

## 2. Topology > model after quality convergence — architecture search over AODL programs

### What “topology dominates model” means in the paper

1. **Definition (ε-convergence):** On benchmark \(\mathcal{B}\), all models in pool \(\mathcal{M}\) have scores within ε of each other.
2. **Proposition (orchestration dominance):** With Lipschitz aggregation and uniform subtask weights,  
   \(\mathrm{Var}_\tau / \mathrm{Var}_M \gtrsim (\omega-1)^2 (1-\gamma)^2 / (4\epsilon^2 k)\).  
   As **ε → 0** and tasks have **ω > 1**, the ratio blows up — **variance from picking topology exceeds variance from picking model**.
3. **Empirical corroboration (same model pool):** 12–23% gains vs static single-topology baselines; **Static-Parallel hurts GPQA** (coupling mismatch). **Self-MoA (matched)** captures most but not all gain — remaining gap attributed to **non-uniform compute allocation** from dependency-aware routing (topology), not model mixing.

So “topology > model **after quality convergence**” is **not** “models don’t matter.” It means: **once the model pool is interchangeable within ε, marginal optimization budget should shift to orchestration structure** (decomposition DAG, coupling, stage partition, synthesis), matching AdaptOrch’s “Era 2: Orchestration Design” figure.

### Implications for architecture search over AODL **programs**

Treat an AODL document (intent \(\mathcal{O}^{\mathrm{intent}}\)) as a point in a ** constrained program space**:

- **Search variables:** subgraph layout, edge relations (`sequence` / `fanout` / …), **`policies.kinds`**, reducers, coupling-like metadata on deps (AdaptOrch’s \(c(u,v)\) is an external annotation on \(E\), not a free-form label).
- **Search operator:** AdaptOrch’s router is a **deterministic map** \(G_T \mapsto \tau \in \{\tau_P,\tau_S,\tau_H,\tau_X\}\) in \(O(|V|+|E|)\) (plus LLM decomposition cost). Analog in AODL: a **validated rewrite** from task DAG features to a **template program** that `validate.py` accepts — i.e. **\(\Pi_t\) selection**, not schema mutation.
- **Objective:** task score under fixed ε-convergent harness models (paper: accuracy, latency, tokens; Pareto). Evo-Bench-style **\(A_t = (\pi, H_t)\)** fits: **\(H_t\)** = compiled plan from AODL; **\(\pi\)** = model routing inside nodes — once ε is small, **edit \(H_t\)** (topology) before chasing another model checkpoint.
- **Failure modes for search:**
  - **Invalid programs** (⊥): undeclared hybrid, message mesh without session typing, inferred swarm — search must **fail closed**, not “best effort” compile.
  - **Decomposition error:** ablation shows removing decomposition collapses to single-best; search over topology **conditional on wrong \(G_T\)** is wasted (paper §Limitations).
  - **Early saturation:** C(RAID) / Evo-Bench warning — unbounded self-edit of IR without new validation fixtures yields diminishing returns; topology search should stay inside **versioned kinds + golden tests**.

**Practical catalog stance (from internal C(RAID) notes):** AdaptOrch supports **\(\Pi_t\) selection over AODL programs** after convergence; it does **not** justify new **`policies.kinds`** or inferring **`swarm`** from DAG shape. Hybrid must remain **explicitly named** when \(\tau_X\) is the intent.

---

## 3. Unlabeled hybrid stays ⊥ (fail closed)

AdaptOrch’s **\(\tau_X\)** is precisely: **partition \(G_T\) into topological layers \(S_1,\ldots,S_m\)**; parallel inside \(S_l\), sequential across layers. That is a **semantic hybrid**, not “anything that looks busy.”

AODL rule (competitors / continuous-insights join):

- **Crew / role teams / mixed parallel+serial canvases** without **`policies.kinds: hybrid`** (and supporting graph fixtures) compile to **⊥** — “Crew = unlabeled hybrid until `policies.kinds`.”
- **“Hybrid” must stay named** in AdaptOrch mapping: recovering a stage-layered DAG from a diagram is **not** enough; the kind string and valid control edges must be present.

AdaptOrch never routes to an implicit “crew topology”; it routes to **\(\tau_X\)** with an **explicit stage partition** from Algorithm 1. The AODL analogue is: **declare hybrid + encode layers**, or validation rejects.

Synthesis retry (increase \(\gamma\), force \(\tau_H\)) is **within-paper** adaptation — it does not create a new AODL kind; it re-selects among the same four templates.

---

## 4. Do not infer `swarm` from a drawing

**Paper evidence:**

- Canonical set is **exactly four** symbols \(\tau_P,\tau_S,\tau_H,\tau_X\). **“Swarm” does not appear** as a topology class.
- **\(\tau_H\)** is **lead-agent delegation** (monitor, reconcile, inbox metaphor) — related to Claude Agent Teams **lead pattern**, not stigmergy or unbounded spawn.
- **Figure 1 (paradigm shift)** shows only parallel, sequential, hierarchy under “decompose + route” — a **pedagogical TikZ**, not an exhaustive taxonomy. It omits hybrid entirely; **must not** be read as “three kinds + default swarm for the rest.”
- **Figure / clustering (Appendix):** “Diamond (fan-out/fan-in)” aligns with **\(\tau_X\)**, not swarm. Wide-shallow → \(\tau_P\); deep-narrow → \(\tau_H\).

**AODL evidence:**

- **`policies.kinds: swarm`** requires explicit declaration and bounds (spawn/recursion), same as **`hybrid`**.
- **\(S_t\)** readings (bMAS, SwarmWorld, stigmergy papers) are **stateStore / observation** interpretations — **not** `policies.kinds: swarm`.
- Competitors table verdict on AdaptOrch: **KEEP** for \(\Pi_t\) over topologies after convergence; **SKIP** pattern **“Inferring swarm from a silhouette.”**

**Operational rule:** If a canvas shows many agents, radial spokes, or “hive” branding, the compiler answer is: **what is declared on \(E_t\), \(\Pi_t\), and `policies.kinds`?** Until then — especially for crew-like **unlabeled hybrid** — treat as **⊥**, not swarm.

---

## References (primary)

- Yu, G. *AdaptOrch: Task-Adaptive Multi-Agent Orchestration in the Era of LLM Performance Convergence*, arXiv:2602.16873, Feb 2026.
- Internal join: `docs/research/aodl-craid-20260911.md`, `docs/research/competitors-100-20260911.md`, `docs/research/continuous-insights-20260911.md`.
