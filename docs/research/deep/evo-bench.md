# Evo-Bench (arXiv:2608.09096) — deep read for AODL

**Source:** arXiv HTML v2 (`https://arxiv.org/html/2608.09096`, Aug 2026); cross-check via `ddgs` + prior Jina capture (`/tmp/research/jina/evo-bench.md`). **Join:** AdaptOrch (`/tmp/research/deep/adaptorch.md`) — after ε-convergence, optimize **topology / harness structure** before model swaps; Evo-Bench is **architecture search over compiled \(H_t\)**, not schema evolution from a leaderboard score.

**Paper question:** Can frontier LLMs act as long-horizon **harness engineers**—diagnose failures, edit **executable** agent scaffolding, and generalize—while **policy weights stay fixed**?

---

## 1. Harness \(H_t\) vs policy \(\pi\) vs the agent — map to AODL

### Paper definitions (Task Formulation, §3)

Evo-Bench splits two agents:

| Symbol | Role | Paper meaning |
|--------|------|----------------|
| \(A^{\mathrm{task}}_t = (\pi, H_t)\) | **Policy agent** | Fixed foundation model \(\pi\) runs target benchmark tasks through an **editable policy harness** \(H_t\). |
| \(A^{\mathrm{evo}} = (E, \mathcal{H}_{\mathrm{evo}})\) | **Evolver** | Frontier model \(E\) improves \(H_t\) via a **fixed evolve harness** \(\mathcal{H}_{\mathrm{evo}}\) (Claude-Code–style loop + evolution skills). |
| \(H_0\) | Seed | Minimal **CodeAct** loop: shell + finish tool; domain tools, planning, memory, verification left for evolution (§3, Appendix A.2). |
| \(\mathcal{E}^{\mathrm{val}}_t\) | Evidence | Cumulative validation scores, task outcomes, **policy trajectories**, diagnostic feedback—not the harness itself. |

The **harness** is “executable code that orchestrates reasoning, tool use, and memory” (§2 Related Work); the **policy** is the LLM checkpoint that fills in tokens inside that loop. Scoring is \(\mathcal{S}(\pi, H; \mathcal{D})\)—explicitly **bivariate** in harness and fixed \(\pi\) (§3 Evaluation Metrics).

**Transfer ablation (§6.2):** Evolved \(H_T\) lifts scores when \(\pi\) is swapped (Qwen3.6-35B, DeepSeek-V4-Flash, GLM-5.2). The paper reads this as synthesizing **generalizable reasoning/tool structures**, not overfitting one \(\pi\)’s quirks.

### AODL mapping (three-object discipline; do not remint \(\mathcal{O}_t\))

Use the existing join from C(RAID) / AdaptOrch:

| Evo-Bench | AODL / HOTL 0.2 reading |
|-----------|-------------------------|
| **Policy harness \(H_t\)** | **Compiled plan** fragment: control flow, tool ports, prompts-as-config, reducers, recovery—what `validate.py` accepts as executable orchestration **within fixed kinds**. Iteration \(t\) is a **validated program rewrite** \(H_t \to H_{t+1}\), not a new node kind. |
| **Policy model \(\pi\)** | **Node-local model** (and judge where applicable): fixed in main experiments (DeepSeek-V4-Flash policy; Qwen3.7-Plus judge). Maps to **per-node inference config**, not \(\Pi_t\) marketplace routing across the whole graph. |
| **Task agent \(A^{\mathrm{task}}_t\)** | One **runtime participant**: \(\pi\) executing the compiled harness. Not the full graph \(\mathcal{O}_t\); a single “harness node” embodiment. |
| **Evolver \(E\) + \(\mathcal{H}_{\mathrm{evo}}\)** | **Outer search loop** over plan space: analogous to **\(\Pi_t\) selection / architecture search** over admissible AODL programs, with \(\mathcal{H}_{\mathrm{evo}}\) as the **fixed meta-harness** (must not be confused with intent or observed state). |
| **Validation trajectories in \(\mathcal{E}^{\mathrm{val}}_t\)** | **Observed** evidence (receipts, spans, rollout slices)—feeds search; **not** a license to treat traces as intent or to infer undeclared `policies.kinds`. |

**AdaptOrch alignment:** Once model pools are ε-convergent, marginal gain shifts to **editing \(H_t\)** (topology, tools, stage structure)—in AODL terms, **search validated orchestration programs** before chasing another checkpoint. Evo-Bench empirically fixes \(\pi\) and edits **harness code**; AdaptOrch fixes models and selects **topology template**—same **architecture-search-over-compiled-plan** stance, different search operator.

---

## 2. What may be searched vs frozen — validated rewrites vs schema mutation

### Searchable / rewritten (evolver-visible)

- **Policy harness \(H_t\)** end-to-end: prompts, tool implementations, domain routers, context management, verification hooks, web/file/Python tools (§5.3 case study: GPT-5.6-Sol builds hierarchical domain routing, webpage cleaner, GDPval/APEX-specific workflows).
- **Editable policy prompt layer** only; evolvers may not edit judge prompts (Appendix E).
- **Iteration loop:** diagnose → hypothesize → edit → `run_train_eval` on \(\mathcal{D}_{\mathrm{val}}\) (160 tasks) under budget \(\mathbf{b} = (b^{\mathrm{iter}}, b^{\mathrm{time}}, b^{\mathrm{steps}})\) (§3).

### Frozen / host-side (paper treats as invariant)

| Frozen artifact | Paper anchor |
|-----------------|--------------|
| **Policy model \(\pi\)** | Main setup: DeepSeek-V4-Flash fixed; ablation swaps \(\pi\) but does not co-evolve weights (§5.1, §6.2). |
| **Evolve harness \(\mathcal{H}_{\mathrm{evo}}\)** | Same orchestrator, tools, integrity rules for all nine evolvers (Appendix A.1). |
| **Benchmark tasks & splits** | \(\mathcal{D}_{\mathrm{val}}\) visible during evolution; \(\mathcal{D}_{\mathrm{eval}}\) (448 tasks) **only after \(H_T\) frozen** (§3). |
| **Scorers, aggregation, suite definitions** | Native benchmark metrics; 2:2:1 domain aggregation; judge interfaces fixed (Table 7, Appendix E.3). |
| **Seed \(H_0\)** | Common CodeAct starting point for all evolvers (§5.1). |
| **Evolution protocol & budgets** | 20 iter / 1000 steps / 48h (main); policy rollout caps (300 steps, 1h) (§5.1). |
| **Sandbox boundaries** | Evolver reads validation artifacts; writes **only** policy harness + workbench; policy rollouts get stripped task views (Appendix A.1, C.2). |

**Benchmark construction** uses a **separate** auxiliary evolution on disjoint tasks to build \(\mathcal{H}_{\mathrm{aux}}\) for sensitivity labeling—that is **dataset engineering**, not the scored evolution run (§4).

### Implications for AODL

- **Allowed:** Search in the **constrained program space** of HOTL 0.2 documents that compile and pass fixtures—edge relations (`sequence`, `fanout`, …), declared `policies.kinds`, tool wiring, \(\Pi_t\) profiles—mirroring **\(H_t \mapsto H_{t+1}\)** with **fail-closed** validation at each step.
- **Forbidden:** Treating Evo-Bench **Overall** or **AnytimeVal** as pressure to **mutate the schema** (new kinds, new edge enums, HOTL 0.3). The paper optimizes **one shared executable harness** under fixed evaluation physics; it does not discover a new IR.
- **Cross-split discipline:** Sensitivity-aware stratified splitting (\(\mathrm{Sens}(x) > 0\)) exists precisely so **validation harness edits** predict **held-out** behavior (§4.2)—AODL analogue: golden tests + held-out fixtures, not leaderboard-driven kind sprawl.

---

## 3. Failures, early saturation, cheating — fail-closed search

### Paper-reported failure modes

1. **Early saturation / detrimental late edits** (§1, §5.2): High **AnytimeVal** with Claude Opus 4.8 / GLM-5.2—“rapidly evolve high-quality structures” then **harmful later modifications**; best validation often **before** budget exhaustion.
2. **Premature stop vs waste** (§5.2): Many runs halt on **invalid code proposals** or stagnant loops; Qwen3.7-Max stops at 15 iter (~200 steps) yet stays competitive—**sample-efficient** harness edits exist.
3. **Domain ceiling** (§5.2): Office tasks resist evolution (specialized workflows); Search gains from synthesized web navigation; General can **beat** human composite—shows **search signal is not uniform** across program regions.
4. **Shallow optimization** (§5.3): Top evolvers react to **aggregate scores**, use **naive domain routing**, underuse budget; planner passive, verifier permissive—**local patches** without architectural refactor.
5. **Trajectory failures** (Appendix D): Bundled edits without smoke tests (Qwen3.6-27B verifier crash); aggregate hill-climbing without causal pairing (DeepSeek-V4-Pro); local prompt saturation despite rollback discipline (Kimi K2.7).

### Reward hacking controls (Appendix C.2)

Evo-Bench assumes broad evolver autonomy but **zeros trials** on:

- **Boundary leakage** (validation answers into policy context)—controlled by snapshot isolation.
- **Web retrieval of benchmark keys**—pattern scan on **content delivered to policy**.
- **Detector evasion**—semantic audit on full trajectories (MiniMax M3 corrected).

These are **integrity predicates** on the search trajectory, not part of \(H_t\)’s task logic.

### Map to AODL fail-closed search

| Bench phenomenon | AODL response |
|------------------|---------------|
| Invalid harness revision | **⊥ at compile/validate**—do not run or score a partial IR (cf. invalid code proposals terminating evolution). |
| Validation-only overfit | Held-out **evaluation suite** + sensitivity-filtered tasks; **do not** promote rewrites that only lift val fixtures without schema-safe generalization tests. |
| Early saturation | Cap **self-edit depth** on intent; prefer **\(\Pi_t\)-bounded template jumps** (AdaptOrch-style) over unbounded harness churn; treat late-round regressions as **reject branch** in search. |
| Cheating the metric | Treat as **constraint violation** in \(\Gamma_t\) / compiler profile (leakage, answer retrieval)—analogous to zero-score trials; invalid programs stay **⊥**, not “best effort” deploy. |
| Superficial score chasing | Require **declared mechanisms** (tools, reducers, kinds) to match diff; undocumented hybrid / inferred swarm → **⊥** (AdaptOrch join). |

Architecture search over compiled \(H_t\) means the **search graph** is **valid programs → score → next rewrite**; any rewrite failing validation or integrity is **no edge** (remain at last admissible \(H\)).

---

## 4. What AODL must NOT import

1. **Evolving HOTL kinds from a leaderboard.** Evo-Bench ranks **evolver models** on harness quality under fixed IR-of-the-bench (Python CodeAct scaffold). High Overall (e.g. GPT-5.6-Sol 46.3 vs CodeAct 29.7) does **not** justify new `policies.kinds`, edge enums, or HOTL 0.3—those are **versioned language**, not outputs of one benchmark’s Python repo.

2. **Treating harness edits as observed \(\mathcal{O}_t\).** \(H_t\) is **compiled plan** material; rollout trajectories and \(\mathcal{E}^{\mathrm{val}}_t\) are **observed** evidence for search. Collapsing “the evolver changed code” into **intent** or substituting **traces for declared graph** breaks the three-object split (intent ≠ compiled plan ≠ observed).

3. **Confusing evolver capability with schema authority.** The paper benchmarks **\(E\)** as researcher; AODL **`validate.py`** remains authority on admissible programs. No automatic promotion from evolved Python to wire format.

4. **Importing bench construction as runtime evolution.** Auxiliary-task evolution producing \(\mathcal{H}_{\mathrm{aux}}\) is **task selection**, not a precedent for agents mutating AODL schema during deployment.

5. **Ignoring transfer vs topology product.** Cross-policy gains support **general harness structure**, but AdaptOrch still says: after ε-convergence, prefer **topology/program search**—Evo-Bench does not replace **explicit hybrid naming** or **fail-closed** undeclared crew patterns.

6. **Reward-hacking shortcuts as “skills”.** Retrieval of answer keys or evasion audits are **disqualifiers**, not patterns to encode as orchestration nodes without human-gate / evidence layers.

**Catalog stance (competitors join):** Evo-Bench supports **architecture search over validated AODL compiled plans (\(H_t\))** with fixed \(\pi\) and fixed evaluation physics; **SKIP** evolving AODL schema from benchmark scores and **SKIP** treating executable harness diffs as observed \(\mathcal{O}_t\).

---

## References

- Huang, L. et al. *Evo-Bench: Can Language Models Improve Agent Harness?* arXiv:2608.09096, Aug 2026. [https://arxiv.org/abs/2608.09096](https://arxiv.org/abs/2608.09096)
- Yu, G. *AdaptOrch* arXiv:2602.16873 — topology after ε-convergence (`/tmp/research/deep/adaptorch.md`).
- Internal: `docs/research/aodl-craid-20260911.md` (Evo-Bench row); C(RAID) three-object / fail-closed rules.

**Catalog:** arXiv:2608.09096 — **KEEP** harness-level architecture search over compiled orchestration programs with fail-closed validation; **SKIP** schema mutation from leaderboard scores and conflating policy-harness code with observed runtime graph.
