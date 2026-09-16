# AgentSpawn (arXiv:2602.07072) — deep read for AODL

**Source:** full text via arXiv HTML (`https://arxiv.org/html/2602.07072`, Feb 2026) through Jina reader (`r.jina.ai`).  
**Paper claim:** runtime **dynamic spawning** for long-horizon code generation — memory slice on spawn, complexity-triggered spawn policy, spawn–resume packages, and coherence for concurrent children. Related work positions this as turning offline/static workflow graphs into **dynamic trees** at execution time (§2.6).

**Epistemic note (paper-faithful):** §4 reports benchmark numbers, but §6 lists “implementing the AgentSpawn prototype” as future work; treat empirical tables as **evaluation design + projected outcomes** unless a separate artifact exists. Architecture and algorithms below are still the paper’s stated contract.

**AODL frame (unchanged):** \(\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\) — intent graph + policies + constraints + provenance vs compiled plan \(H_t\) vs observed \(S_t\). AgentSpawn is a **runtime orchestration pattern**, not a HOTL 0.3 kind.

---

## 1. Dynamic spawning — mechanism, bounds, parent/child graph → `policies.dynamic` / spawn bounds / \(\Gamma_t\)

### When a child is created (paper)

**Spawn Controller** (§3.1) runs **Algorithm 2** on the parent’s state \(S_{\text{parent}}\), current task \(T\), and five normalized complexity metrics \(I_f, C_c, F_c, O_c, U_c\) (file interdependency, cyclomatic complexity, test-failure cascade, context fill, action uncertainty from logprobs).

1. Collect and normalize each metric to \([0,1]\) (Eq. 3).
2. Weighted spawn score \(S_{\text{spawn}} = \sum_{i=1}^5 w_i \cdot \mathrm{Norm}(M_i)\) with \(\sum w_i = 1\), \(w_i \ge 0\) (Eq. 4; weights in Table 1, “proposed” / Bayes-opt in full system).
3. If \(S_{\text{spawn}} > \delta\) (paper figure: **\(\delta = 0.7\)**), **spawn**; else **continue** solo.
4. Specialization is chosen by **argmax** of normalized metrics (refactoring vs simplification vs testing vs context compression vs research).

On spawn, the parent builds snapshot \(\Sigma\) / **`SpawnPackage`** (Appendix A): `spawn_id`, `parent_id`, timestamp, **memory slice** (Algorithm 1, threshold \(\theta\)), inherited skills (Eq. 2, threshold \(\tau_{\text{skill}}\)), execution **context** (`repo_path`, `current_file`, `line_number`, `pending_changes`), child **task** spec, and **`spawn_metrics`** recording what triggered spawn.

Child completion returns **`ResumePackage`**: status, `code_diff`, `files_modified`, **execution `trace`**, learned skills, metrics. Parent **context replay** (§3.5.2): summarize trace, merge child episodic memory, promote skills, **apply code changes** — with §5.3 **validation checks before merging**.

### Parent/child graph shape

- Positioning (§2.6): “converting static graphs into **dynamic trees**” — spawn adds children under a parent; **multiple children** may run **concurrently** (§3.6, Figure 4: four children on memory snapshots).
- Edges are implicit **parent → child** spawn relations plus **resume** return; not a predeclared Crew/MetaGPT role graph.
- **Spawn depth:** §5.3 proposes **at most 3 levels** (parent → child → grandchild) to avoid unbounded recursion and coordination blow-up; “adaptive depth limits remain an open problem” (§5.4).
- **Per-child bounds:** max **30 minutes** per child; failure/timeout handling before merge (§5.3).
- Algorithm 2 itself has **no** explicit cap on **count** of spawns per task — only depth is discussed as a scalability guard.

### AODL mapping (no new kind)

| AgentSpawn concept | AODL slot | Notes |
|--------------------|-----------|--------|
| Whether spawn may occur at all | `policies.dynamic` | Declared allowance + **spawn policy profile** (complexity thresholds, metric weights) = part of \(\Pi_t\), not an extra vertex kind. |
| How many / how deep | `policies.dynamic.maxChildren` (and depth/recursion fixtures) + \(\Gamma_t\) budgets | Paper’s depth-3 and timeout-30m are **constraint** material (`constraints.budgets` / spawn recursion witness), same family as bounded recursion fixtures and `fix_n` on nodes. |
| Who may spawn whom | \(V_t\) + `delegation` / supervisor edges in **intent** | Runtime tree must be a **refinement** of declared spawn authority, not a fresh graph invented by the child. |
| SpawnPackage / ResumePackage | Observed \(S_t\) + `observation` receipts | Serialized packages are **evidence** of what was handed off and returned; they do not replace intent \(V_t,E_t\). |
| Coherence after concurrent spawns | `stateStore` / file-diff observation + **verifier** downstream | Algorithm 3 is merge of child **results**, not graph kind “coherence”. |

**Hermes dry-run profile (catalog):** `hermes_dryrun.py` fails closed when `policies.dynamic.allowed` is true **or** `maxChildren > 0` — conservative Gate 1 treats **any** declared dynamic spawn as out of scope for Kanban cards+deps-only projection. That is interchange policy, not a denial that bounded spawn belongs in full AODL intent; it forces spawn to be **explicit, bounded, and validated** before a compiled plan admits it.

**Conservative read:** AgentSpawn’s Algorithm 2 is an **oracle inside the parent node** (\(\lambda_A\)-style metacognition: “am I the right agent?”). The **graph mutation** (new child actor) must be anticipated by `policies.dynamic` + caps in \(\Gamma_t\); otherwise validation should be **⊥**, not “spawn anyway and patch intent later.”

---

## 2. Runtime graph mutation vs declared intent vs compiled plan \(H_t\) — fail closed vs validated \(\Pi_t\) / \(H_t\) rewrite

### What AgentSpawn does

- **Pre-query** systems (DAAO, AFLOW) fix workflow shape before run; AgentSpawn adds **mid-execution** branching when metrics exceed \(\delta\) (§1.2 Gap 4, §2.6).
- Each spawn **adds** a child agent and **suspends** parent progress on that subtask until **ResumePackage** (spawn–resume protocol, §3.5).
- Concurrent spawns **mutate shared code state** through diffs; coherence manager reconciles overlaps (Algorithm 3).

So AgentSpawn’s live system is closer to **observed graph growth** (\(V_t, E_t\) at time \(t\)) driven by \(\Pi_t^{\mathrm{runtime}}\) (Algorithm 2) than to a static compiled DAG.

### AODL three-object discipline

Catalog objects (intent / compiled plan / observed) **must not be substituted**:

| Layer | AgentSpawn analogue | AODL rule |
|-------|---------------------|-----------|
| **Intent** | Template: “parent may spawn specialists when metrics fire” + max depth/children + repo context class | Document declares `policies.dynamic`, spawn bounds, and which specializations exist as **profiles** or reserved child slots. |
| **Compiled plan \(H_t\)** | Hermes/Keel projection of **known** cards and deps | Gate 1 dry-run: **no** dynamic spawn in profile → ⊥ if dynamic allowed without a different compiler profile. |
| **Observed** | Actual spawn tree, Spawn/Resume packages, traces, merged diffs | Append-only receipts; **does not retroactively edit** intent. |

**Fail closed (⊥):**

- Spawn at runtime when intent has **no** `policies.dynamic` (or forbidden by profile).
- Observed child count or depth **exceeds** `maxChildren` / declared recursion budget in \(\Gamma_t\).
- Treating **spawn trace** or **LLM semantic merge** (Algorithm 3, 73% success, Eq. 6) as satisfying **verification** or compile witnesses.
- Inferring a **`swarm`** or **`hybrid`** kind from a tree shape that was not named in `policies.kinds`.

**Allow (validated rewrite, not silent mutation):**

- **\(\Pi_t\) selection:** choose among **pre-validated** spawn policies (metric weights, \(\delta\), specialization table) — same spirit as AdaptOrch router over templates: search inside the space of documents `validate.py` accepts.
- **\(H_t\) refresh:** after a **declared** spawn event, compiler may emit **new** cards/deps for **reserved** child node ids already in intent (bounded expansion), not unbounded new ids from the LLM.
- **Plan repair** that adds nodes must re-validate against schema + fixtures (bounded recursion fixture is the catalog pattern); otherwise hold or abort per `humanGate` / budget in \(\Gamma_t\).

AgentSpawn’s “static graph → dynamic tree” slogan is **runtime behavior**; AODL only accepts it when the **intent** already encodes bounded dynamic expansion and the **compiler** knows how to project or refuse.

---

## 3. Long-horizon code generation — shared workspace vs message-passing; merge ≠ verify

### Coordination model (paper)

**Not** pure message-passing orchestration:

- **Shared engineering workspace:** SpawnPackage `context` includes `repo_path`, `current_file`, `pending_changes`; ResumePackage returns `code_diff`, `files_modified` (Appendix A).
- **Shared memory substrate:** Parent memory \(M_{\text{parent}} = \{M_{\text{epi}}, M_{\text{sem}}, M_{\text{work}}\}\) (§3.2.1); child gets **slice** \(M_{\text{slice}}\) (Algorithm 1), not a greenfield chat channel.
- **Concurrent children** work on **memory snapshots** then return diffs; **Memory Coherence Manager** merges overlapping file changes (Algorithm 3).

**Message-like** elements exist (task description, execution trace in ResumePackage for parent replay, §3.5.2) but the dominant long-horizon coupling is **observation of shared repo + selective memory slice**, aligned with CodeCRDT/StateFuse catalog line: **`observation` + `stateStore`**, not “agents only talk.”

### Merge ≠ verify (mandatory for AODL)

Paper itself separates layers:

1. **Auto-merge** (15%): non-overlapping lines.
2. **Semantic merge** (73%): `LLM_merge` reconciles intent of overlapping diffs.
3. **Escalation** (12%): parent manual resolution; Eq. 6 gives **0.0** success probability when escalated.

§5.3: **validation checks before merging** child results; §5.4: highly coupled edits remain hard (semantic merge rate varies).

AODL composition (same as CodeCRDT / merge-neq-verify notes):

- File-level / character-level merge convergence → **observed** history on `stateStore`.
- Tests, types, SWE-bench success, “task completion rate” → **verifier** node or harness profile, **independent** of merge.
- AgentSpawn’s reported “coherence violations” metric (§4.1) is an **audit** statistic, not a substitute for \(\Gamma_t\) verification goals.

**Reminder:** If children **share files**, CRDT/optimistic-merge **does not** prove semantic correctness — only that conflicts were **handled** per a three-tier policy. AODL must keep **verifier independence** when mapping AgentSpawn’s coherence protocol.

---

## 4. What AODL must **not** import from AgentSpawn

1. **Unbounded spawn as a product feature.** Paper warns on depth > 3 and open depth limits (§5.3–5.4); Algorithm 2 has no global spawn-count stop. AODL must **fail closed** on missing `maxChildren`/depth/recursion witnesses — not treat “runtime optimizable composition” as permission to grow \(V_t\) without cap (catalog: competitors row — **unbounded spawn** is the anti-pattern).

2. **Spawn traces and ResumePackages as observed authority.** `trace` and `spawn_metrics` support parent **metacognitive replay** (§3.5.2, §5.2); they are not compile witnesses and must not **back-edit** intent or \(\Pi_t\) without re-validation.

3. **LLM semantic merge as verifier.** Algorithm 3’s `LLM_merge` is conflict **reconciliation**, not proof that merged code satisfies task constraints; 27% failure modes + escalation are explicit.

4. **Runtime tree silhouette → `policies.kinds`.** Dynamic tree ≠ `swarm` / `hybrid` unless declared with fixtures (AdaptOrch/C(RAID) rule carries over).

5. **Metric-oracle spawn as implicit \(\Pi_t\).** Weights in Table 1 are “proposed”; without document-level policy, the spawn controller is an **undeclared scheduler** — violates AODL “IR + validator, not scheduler.”

6. **Empirical tables as validation of interchange.** Until bounded-spawn fixtures and verifier profiles exist in `validate.py`, AgentSpawn remains **adjacent research** for `policies.dynamic` semantics, not evidence for HOTL 0.3.

---

**Catalog:** AgentSpawn — arXiv [2602.07072](https://arxiv.org/abs/2602.07072): bounded `policies.dynamic` + spawn recursion in \(\Gamma_t\), `stateStore`/diff observation with merge ≠ verify; reject unbounded spawn and spawn-trace authority.
