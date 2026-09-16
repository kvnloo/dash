# CodeCRDT [2510.18893] × AODL (HOTL 0.2)

Full-text read: arXiv **2510.18893v1** (Pugachev, *Observation-Driven Coordination for Multi-Agent LLM Code Generation*), via ar5iv HTML + Jina PDF extract. Companion: [`merge-neq-verify.md`](merge-neq-verify.md) (StateFuse × same fault line). **No new HOTL kinds**; slot unchanged: **`observation` + `stateStore`**.

---

## 1. Exact coordination model → AODL `observation` + `stateStore`

### Pattern (paper §1, §3.1–3.2)

**Observation-driven coordination** means agents coordinate by **monitoring shared state** with (1) **observable updates** (subscribe to changes), (2) **deterministic convergence** (all agents eventually see the same state without manual merge), and (3) **monotonic progress** (no rollbacks that invalidate completed work). Coordination is **not** explicit inter-agent message passing; the **CRDT document is the coordination substrate** (§4.1: “No explicit message passing—CRDT state serves as coordination substrate”).

CodeCRDT **instantiates** this with **Yjs** over a **Hocuspocus** WebSocket relay (SEC; centralized relay for persistence/observability, §3.2). The paper stresses the **pattern** generalizes to OT or replicated logs if the three substrate properties hold; evaluation characterizes the **pattern**, not CRDT optimality (§5.4).

### What is observed

Agents subscribe to **CRDT update events** (Table 2, §3.3):

| Yjs type | Role | Convergence / invariant |
|----------|------|-------------------------|
| **`Y.Text`** | Shared **code document** (TypeScript/React) | Character-level merge; deterministic total order on ops |
| **`Y.Map`** | **TODO** registry: `{description, status ∈ {pending, claimed, done}, assignedTo, logicalClock}` | LWW register **per key**; at-most-one `assignedTo` winner after SEC |
| **`Y.Array`** | Append-only **audit trail** | Causally ordered history |

**TODO Observer** scans the map in real time for insertion points (§3.3). **Observation-driven adaptation** (§4.2): completed-work detection (skip done TODOs), context integration (imports/types), naming alignment, conflict avoidance (back off on overlapping edit regions). Propagation: median **50 ms**, p95 **200 ms**; observation cost **O(N × U)** (N agents, U updates).

### What is the CRDT (vs “the agents”)

The **replicated Yjs document** is the shared **stateStore** body: text + task map + audit log. **Merge** is automatic SEC on concurrent writes:

- **Character-level:** concurrent inserts at the same line **interleave** in operation-ID order; **0% merge failures** / no manual conflict resolution (§4.3, §6.4).
- **Task-level:** **TODO-claim protocol** on `Y.Map` — optimistic write, **50 ms** sync wait, re-read `assignedTo`; success only if `assignedTo == self` (Appendix A.5). Safety: LWW on `(logicalClock, clientID)` ⇒ **≤1** successful claimer per TODO after convergence. Liveness: 120 s stale-claim timeout.

### Agent loop (roles + lifecycle)

1. **Outliner** (once): writes skeleton with **TODO placeholders** into `Y.Text` / map.
2. **Implementation agents** (up to **5**, parallel mode): concurrently **scan** `Y.Map` for `{pending, assignedTo=null}`, **claim**, on success fill TODO via **cursor tool** into `Y.Text`; on failure retry next TODO. No orchestrator assigns tasks.
3. **Evaluator** (terminal): waits for completion; scores quality/architecture/performance/accessibility (0–20 each); for **semantic** issues uses **TypeScript diagnostics** and auto-fix or flag (§4.3).

Sequential vs parallel modes (§5.2): same pattern; parallel runs multiple implementation agents after outliner.

### AODL mapping (not `swarm`)

| CodeCRDT concept | AODL reading |
|------------------|--------------|
| Shared Yjs doc + relay | **`stateStore`** — declared shared mutable artifact with convergence semantics |
| CRDT `observe()` / event callbacks | **`observation`** edges — receipts that an agent (or harness) **read** store deltas |
| Agent writes into CRDT | Tool/harness **writes** into the same store (still not a new kind) |
| Outliner → implementers → evaluator | Ordinary **agent/harness** nodes in \(\mathcal{O}_t\); edges are **data/control** into `stateStore`, not `policies.kinds: swarm` |
| TODO-claim LWW | **Coordination policy inside the adapter profile**, not a HOTL vertex type |

Stigmergy/Linda/blackboard are **cited lineage** (§2.1); AODL catalogs this as **blackboard-style observation**, not decentralized swarm topology.

---

## 2. Character-level merge success vs semantic residual

### Character-level / SEC (RQ3, §4.3, §6.4)

- **600/600** evaluation pipeline completions; **zero** crashes, data corruption, or CRDT sync errors (§6.1, §6.4).
- **“100% convergence”** / **“zero merge failures”** = all replicas reach **identical** replicated state; **edits may interleave** but never require human merge (contrast git **structural** branch merges, §7.1).
- **0% character-level conflicts** in the paper’s sense = **no manual conflict resolution**; not “no concurrent edits.”

### Semantic residual (~5–10%)

- **Definition (§4.3):** CRDTs **cannot** detect duplicate declarations, type mismatches, broken references.
- **Measurement:** **Manual inspection of 60/600 runs (10% sample)** ⇒ **~5–10%** runs with semantic conflicts; **high task variance** (paper reports **~20%** on simple tasks vs **~80%** on complex tasks in that sample). Authors flag **comprehensive measurement across all 600** as future work (§7.2 limitation 4).
- **Examples (abstract, §1):** duplicate declarations, type mismatches → **post-generation reconciliation** required.

### Objective metrics vs semantics (Table 5, §6.3)

On **all 600** samples, **TypeScript errors per 1000 characters** (syntactic):

- Parallel often **reduces** TS error rate on 5/6 tasks (e.g. Visualizer **3.78 → 0.92**, −76%***).
- **Markdown Editor** worsens (+24% errors); coupled tasks called out.
- Paper explicitly: static analysis captures **syntactic** correctness only; **“missing semantic/deep quality”**; parallel can show **fewer TS errors but lower LLM Code Quality scores** (−7.7%, \(d_z=-0.71\)) — “optimizes for compilability over maintainability” (§6.3).

### What a verifier node must still do (AODL, no new kind)

CRDT SEC only certifies **representation convergence**. A **verifier-adjacent** node (existing compile/test/`observation` witness, human gate, or evaluator-like harness) must still:

1. **Semantic reconciliation** — duplicate symbols, inconsistent types, broken refs (paper’s Evaluator + TS diagnostics; future LSP/AST, §7.2).
2. **Intent / rubric** — LLM evaluator dimensions (functionality, accessibility −5.6%, etc.) are **not** implied by merge.
3. **Runtime correctness** — paper defers functional/runtime testing to future work (§7.2).
4. **Fail-closed on unresolved semantics** — treat converged text as **observed artifact**, not proof \(\mathcal{O}^{\mathrm{intent}}\) holds (aligned with [`merge-neq-verify.md`](merge-neq-verify.md)).

---

## 3. vs message-passing MAS and vs StateFuse

### Message-passing / pipeline MAS (§2.3, §7.1)

| Dimension | ChatDev / MetaGPT-style | CodeCRDT |
|-----------|-------------------------|----------|
| Coordination | **Explicit messages**, waterfall/pipeline | **Shared CRDT state** only |
| Concurrency | Sequential phases | Lock-free **parallel** implementers |
| Consistency | Orchestrator or phase locks | **SEC** + formal TODO-claim safety |
| Merge pain | Git-style **15–30%** deferred conflicts (intro, §1) | **Automatic** character merge; semantic residue separate |

Orchestrator-based systems assign tasks by **message**; CodeCRDT assigns by **observing** TODO map + claiming via CRDT writes.

### vs StateFuse (2607.05844) — same slot, different mechanism

| | **CodeCRDT** | **StateFuse** |
|---|--------------|---------------|
| Replicated object | **Yjs** text + map (CRDT cells) | **OpSet** of immutable ops (`EvidenceAdded`, `ClaimAdded`, …) |
| Merge | CRDT join / LWW per key | \(\mathrm{merge}(O_1,O_2)=O_1\cup O_2\) |
| Conflict visibility | **Implicit** in text; semantic conflicts **not** first-class in the store | **`ConflictSet`** + `surfaced_conflicts` in materialization |
| Read authority | Agents read **converged document** | **Projection** may **abstain**; resolver cannot mutate \(M\) |
| Correction | Evaluator / TS fixes; 120 s claim timeout | **`claim_id` / `claim_ref` retractions** |

CodeCRDT **does not** expose predicate-level **`ConflictSet`** or abstaining projection; it **relies** on post-hoc diagnostics. StateFuse **does not** replace a verifier either—it surfaces ambiguity for policy at read time ([`merge-neq-verify.md`](merge-neq-verify.md)). **Composition:** CRDT-converged file in `stateStore`; optional StateFuse-style **evidence layer** for contradictions agents must not collapse silently.

---

## 4. What AODL must NOT import

Per catalog + companion note:

1. **No Yjs/Hocuspocus (or any CRDT lib) in Dash `app/` or `bridge/`** — research/harness profile only.
2. **No new HOTL kinds** (`crdt_merge`, `todo_claim`, `evaluator`, etc.).
3. **Do not rename merge as `verify`** — SEC convergence ≠ intent, types, tests, or cross-file invariants.
4. **Do not treat Evaluator LLM scores or TS error rate as compile witness** without declared verifier policy (paper: no human baseline, LLM scoring subjective, §5.4).
5. **Do not model coordination as `swarm`** — observation-driven **stateStore** is blackboard lineage, not swarm kind.
6. **Do not infer** parallel speedup from raw wall clock alone — paper shows **+13.1%** slower overall response time with **82–189%** code volume inflation confound; normalized per-char analysis is separate evidence.

**KEEP:** Adapter documentation for observation-driven writes/reads on `stateStore`; verifier hooks after projection.

---

## References

- Sergey Pugachev — *CodeCRDT: Observation-Driven Coordination for Multi-Agent LLM Code Generation*, arXiv **2510.18893v1** (18 Oct 2025).
- Companion: `/tmp/research/deep/merge-neq-verify.md` (StateFuse **2607.05844**).

**Catalog:** CodeCRDT is the empirical warrant for **`observation` + `stateStore`** with **merge ≠ verify**—SEC gives a single converged artifact, not semantic proof.
