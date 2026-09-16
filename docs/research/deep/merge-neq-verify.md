# Merge ≠ verify: StateFuse [2607.05844] × CodeCRDT [2510.18893] × AODL

Deep read of **StateFuse** (Jina full text, arXiv HTML 2607.05844v1) with **CodeCRDT** recalled from the AODL C(RAID) catalog. Narrow claim only: replicated convergence is not semantic verification; public conflict surfaces and correction handles are evidence contracts, not new graph kinds.

---

## 1. OpSet/CRDT substrate vs verifier node

### What StateFuse actually owns

StateFuse explicitly **does not** invent a join algebra. Replica merge is standard OpSet semantics:

\[
\mathrm{merge}(O_1, O_2) = O_1 \cup O_2
\]

Immutable ops (`EvidenceAdded`, `ClaimAdded`, `ClaimRetracted`, `DecisionAdded`) converge by set union over `op_id`. **Materialization** \(M(O)\) is a deterministic interpretation: index evidence, apply retractions (exact `claim_id` and semantic `claim_ref` tombstones), group active claims by `ClaimKey`, emit **`ConflictSet`** objects when a *functional* predicate has multiple distinct active values under the predicate registry’s `normalize` / `equal`.

**Projection** \(V(M, \text{resolver}, \text{constraints})\) is a **separate authority boundary**:

- Resolvers may select a candidate, **abstain**, or fail closed on unresolved conflicts.
- Resolvers **cannot mutate** \(M\) or the replicated op-set (Proposition 5: projection non-interference).
- `DecisionAdded` is append-only planning metadata; it does not change truth state.

So the stack is three layers, not one:

| Layer | Role | AODL reading |
|-------|------|----------------|
| **OpSet/CRDT merge** | Convergence of immutable evidence | Observed append-only **history** on a `stateStore` edge (replicas agree on *what was said*) |
| **Materialization** | Deterministic semantics + `ConflictSet` | Typed interpretation under **predicate contracts** (registry); contradictions become **first-class objects** in materialized state |
| **Projection / resolver** | Task-scoped view + abstention | **Verifier-adjacent policy**: chooses among surfaced candidates or refuses to collapse; optional uniform verification budget in the agent loop |

StateFuse’s empirical headline is **not** “CRDT beats flat memory on accuracy.” On MemoryAgentBench’s 282 conflict-bearing questions, surfaces tie at ~97.5% final accuracy; the win is **what the public surface exposes** (contradiction recall) and **safer behavior under verification** (collapsed “latest-write” surfaces: 60% success vs 100% for conflict-preserving + uniform verification in the synthetic loop).

### CodeCRDT (2510.18893) — same fault line

CodeCRDT shifts multi-agent coordination from message-passing to **observing a shared CRDT** (e.g. collaborative code / file state). Reported outcome: **~100% character-level merge success** alongside **~5–10% residual semantic conflicts** that syntactic merge does not detect or resolve.

AODL catalog verdict (unchanged): slot = **`observation` + `stateStore`**; **merge ≠ verify**; **verifier independence is mandatory** — you must not treat CRDT convergence as proof that the merged artifact satisfies intent, types, tests, or cross-file invariants.

### Verifier node (conceptual, not a new HOTL kind)

Neither paper replaces a **verifier** with merge:

- **CRDT/OpSet** answers: “After all replicas exchange ops, do we have the same set of immutable updates and the same deterministic materialization?”
- **Verifier** (compile witness, test run, model-check slice, human gate, abstaining resolver + tool budget) answers: “Does this **projection** satisfy \(\mathcal{O}^{\mathrm{intent}}\) / task gold / safety policy?”

StateFuse moves part of “verification” into **projection-time abstention** and **surfaced_conflicts** so the agent does not act on a silently collapsed view—but that is still **policy at read time**, not a proof that two merged code paths implement the same behavior.

**Composition for AODL:** `stateStore` holds the OpSet-shaped observed history; a downstream node (existing `observation`, `retry`, compile profile, or harness) performs semantic check. Do not fold verifier into merge or rename merge as `verify`.

---

## 2. `claim_id` / conflict surface as AODL evidence

### StateFuse handles

Each claim carries:

- **`claim_id`**: exact per-assertion id — local correction, provenance, precise retraction target.
- **`claim_ref`**: deterministic semantic handle from `(namespace, subject, predicate)` + predicate-governed value contract — **cross-replica** correction when opaque ids differ or were never seen.

Retractions:

- **Exact**: deactivate one assertion.
- **Semantic**: deactivate all instances matching `claim_ref`, including **unseen-target no-resurrection** (retraction before claim still suppresses later arrivals).

Materialization emits **`ConflictSet`** for functional keys with >1 distinct active value. **`surfaced_conflicts`** in `build_view` is the **public contract metric**—contradictions counted from what the decision policy **sees**, not hidden internal multi-values.

Ablation: on semantic-only correction tasks, `claim_ref` recovers corrected values when `claim_id` cannot; `claim_ref` avoids “resurrection” cases `claim_id` misses (76.9% on evaluated resurrection cases for id-only).

### Map to AODL evidence (no new node kinds)

Treat StateFuse ops as **observed evidence** on a declared `stateStore` / blackboard projection, not as new \(\mathcal{O}_t\) vertex types:

| StateFuse object | AODL evidence role |
|------------------|-------------------|
| `EvidenceAdded` | Receipt / pointer into observed store (link to tool output, file hash, trace id) |
| `ClaimAdded` | Atomic assertion under a key; attach **`claim_id`** as stable evidence id in observed metadata |
| `ClaimRetracted` | Explicit invalidation edge in the observation graph (fail-closed: retracted claims excluded from conflict candidates) |
| `ConflictSet` | **Surfaced contradiction** — candidate set the planner must not treat as a single fact without resolver or verifier |
| `claim_ref` | **Semantic correlate** for cross-branch merge stories (same as “this predicate slot” without reminting intent) |
| `DecisionAdded` | Plan/execution note only; does **not** upgrade to observed truth (sheaf glue still needs receipts) |

**Intent vs observed:** Declared \(\mathcal{O}^{\mathrm{intent}}\) may require functional predicates (“deadline is singular”). Observed \(\mathcal{O}_t\) may contain **multiple active claims** until retraction or verifier-backed selection. **`ConflictSet` + `surfaced_conflicts`** are the fail-closed signal: ADG / compile witness should **not** assert \(\mathcal{O}^{\mathrm{intent}} \models\) observed plan if functional slots are unresolved.

**AgentFlow audit angle:** Recovered graphs from LangGraph/CrewAI fragments may **collapse** multi-writer memory; StateFuse-style surfacing is what you want in the **observation** layer so audit tools see contradictions instead of last-write wins.

---

## 3. Why ~5–10% semantic conflicts survive character merge

CodeCRDT’s split (~100% character merge, ~5–10% semantic conflict) and StateFuse’s “collapsed latest-write ties on accuracy but hides contradictions” are the **same structural lesson** at different granularities.

### Layer mismatch

1. **Merge algebra is syntactic / op-set level.** Union of edits, line merges, or CRDT character cells converges because the datatype’s equality is **representation-level**.
2. **Task truth is semantic / predicate-level.** StateFuse’s registry `equal(left, right)` and functional vs multi-valued predicates define when two claims **collide**. CodeCRDT’s “semantic conflict” is when merged text is **locally convergent** but **globally inconsistent** (behavior, API contracts, duplicate definitions, wrong imports, divergent refactor halves).

### Classes of survivors (illustrative)

- **Non-commutative intent:** Two branches each “fix” the same bug differently; merge keeps both edits; tests pass on one path only.
- **Cross-file invariants:** File A and B merge cleanly in isolation; combined project violates module graph or type graph.
- **Normalization blindness:** Character merge does not apply predicate `normalize` (dates, units, canonical names)—StateFuse puts that in the **contract registry**; raw CRDT text merge does not.
- **Hidden overwrite:** Collapsed surfaces (latest-write, raw-log without conflict surfacing) **remove the symptom** (one value shown) without **resolving** semantics—MemoryAgentBench gold often follows “latest fact,” so accuracy ties while **surfaced conflict recall** goes to zero.
- **Correction without resurrection:** Semantic retractions matter when ids differ across replicas; character merge has no notion of `claim_ref`.

StateFuse does not eliminate this gap; it **preserves** ambiguity (`ConflictSet`), supports **auditable correction**, and lets **projection + verification** abstain instead of false certainty (collapsed surface: 40% false-confident actions in the uniform-verification loop vs 0% for non-collapsing surfaces).

**Bottom line:** The 5–10% is not a tuning bug; it is the **residual of equating convergence with correctness**. Only an independent verifier (tests, types, static analysis, human, or bounded resolver + tool budget) addresses that residue.

---

## 4. `stateStore` adapter profile — no new kinds

AODL already names the slot. This merge is a **compiler/adapter profile** for how observed state is written and read, not an extension of `policies.kinds`.

### Profile: `stateStore` + StateFuse semantics (documentation / harness only)

**KEEP:** Research memory, catalog UI, harness notes (cf. `nZiben/statefuse` — Python lib, not a Dash dependency).

**SKIP:** New node kinds (`conflict`, `claim`, `crdt_merge`, etc.), vendoring StateFuse into `app/` or `bridge/`, treating merge as verification.

**Adapter responsibilities:**

1. **Write path (observation):** Map tool/branch outputs to immutable ops or to a lossless log that materializes equivalently: evidence pointers, claims with `claim_id` + derived `claim_ref`, retractions on correction.
2. **Read path (projection):** Expose `build_view`-like API to planners: selected claims, **unresolved `ConflictSet`s**, `surfaced_conflicts`, abstention—not a single collapsed string for functional keys.
3. **Predicate registry:** Deterministic `normalize` / `equal` per slot — aligns with AODL’s typed edges without new schema fields (profile config, not HOTL 0.3).
4. **Verifier hook:** After projection, route to existing compile/test/`observation` witnesses; **fail closed** if functional conflicts unresolved and intent requires uniqueness.
5. **Governance (cf. kernel SHM 2609.10144):** Selective inject vs full dump on **read** of `stateStore` — classification on observation edges, not a new vertex type.

### Relation to CodeCRDT profile

| Concern | CodeCRDT | StateFuse |
|---------|----------|-----------|
| Transport | Shared CRDT observation | OpSet merge + materialization |
| Merge success | Character-level | Set union (standard) |
| Conflict visibility | Semantic conflict rate post-merge | Explicit `ConflictSet` + `surfaced_conflicts` |
| Correction | (CRDT-specific) | `claim_id` / `claim_ref` retractions |
| AODL slot | `observation` + `stateStore` | Same |

**Single sentence for catalog:** *StateFuse is how you **surface** CRDT-level disagreement for agents; CodeCRDT is why you still need a **verifier** after the file converges.*

---

## References (this note)

- Yang Li, Ye Luo — *StateFuse: Deterministic Conflict-Preserving Memory for Multi-Agent Systems*, arXiv **2607.05844** (full text via Jina reader, 2607.05844v1 HTML).
- CodeCRDT — arXiv **2510.18893** (AODL catalog: observation + stateStore; merge ≠ verify).
- Workspace: `docs/research/aodl-craid-20260911.md`, `docs/research/continuous-insights-20260911.md`, `docs/research/competitors-100-20260911.md`.
