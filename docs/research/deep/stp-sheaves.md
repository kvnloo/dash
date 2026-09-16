# STP (arXiv 2605.01879) × AODL: three sheaves, no substitution

**Source:** Hernández & Sánchez-Soto, *Sheaf-Theoretic Planning: A Categorical Foundation for Resilient Multi-Agent Autonomous Systems* (arXiv:2605.01879, May 2026). Deep read via Jina on arXiv HTML v1.

**AODL anchor:** The planning ontology keeps three **fixed** objects—`F_World`, `F_Mem`, `F_Goal`—as the only sheaf-grade carriers. They are **never substituted** by operational labels (`intent`, `plan`, `observed`) or by implementation buckets (schema fields, swarm aggregates, topos JSON). Those other names describe *views and pipelines*; they do not replace the triple.

---

## 1. `F_World` / `F_Mem` / `F_Goal` vs `intent` / `plan` / `observed`

### What STP defines

On a temporal site \((\mathcal{T}, \mathcal{J})\) (intervals + Grothendieck covers = causal “local-to-global”):

| STP sheaf | Role in the paper |
|-----------|-------------------|
| \(\mathcal{F}_{\text{World}}\) | Objective reality: sections are consistent histories over intervals; unobserved third-party action is a transformation applied here first. |
| \(\mathcal{F}_{\text{Mem}}\) | Agent memory: what the agent recorded along intervals it actually traversed (including blind intervals while away). |
| \(\mathcal{F}_{\text{Goal}}\) | Target / normative end states the agent is trying to realize. |

Discrepancy (e.g. robot returns after recharge, layout changed) is **not** a monolithic logic contradiction: it is **misalignment between sheaves** over the same site—World moved, Mem did not yet. Abduction is pullback: action sequences \(\mathcal{H}\) that explain Mem → observed stalk vs World.

### AODL parallel (do not identify)

| Fixed AODL object | STP reading | **Not** the same as |
|-------------------|-------------|---------------------|
| `F_World` | Ground truth evolution of the environment under all causes | `observed` (percept at a tick), a database row, or “current state” in an API |
| `F_Mem` | Persisted agent history / belief sections glued over known intervals | `plan` (committed future transforms) or chat context |
| `F_Goal` | Constraint sheaf / desirable end sections | `intent` (pre-commitment, revisable utterance) |

| Operational label | What it actually is in product terms |
|-------------------|--------------------------------------|
| `intent` | Pre-plan utterance or directive; may be withdrawn before any authorized mutation |
| `plan` | Ordered composite of **authorized** mutations the agent intends to apply (STP: composite of natural transformations), not a fourth sheaf |
| `observed` | Sample of sections at a boundary (perception event), a **restriction** or probe into `F_World` ∩ interval, not a replacement for World |

**Rule:** Documentation and catalog copy may **cross-reference** (“observed restricts World on interval \(I\)”) but must **never rename** `F_World`→observed, `F_Mem`→plan, or `F_Goal`→intent. Three objects stay three objects.

---

## 2. Obstruction = fail closed

### What STP says

- **Gluing** merges compatible local sections; when agents disagree on overlaps, there is no unique global section.
- **Cohomology** formalizes obstruction: non-trivial \(H^0\) = multiple incompatible global stories; higher \(H^k\) = more complex obstructions to a global plan.
- Swarm consensus via sheaf Laplacian assumes **compatible restrictions**; zero eigenvalue multiplicity counts consistent global sections.

### AODL operational reading

Treat “obstruction” as a **control decision**, not a prompt for model creativity:

1. If local pieces (Mem, observed slice, Goal constraints) **do not glue** to a unique section over the covered interval → **stop**; do not infer a missing action, do not merge contradictory histories, do not default to “probably fine.”
2. If an update would require **choosing** among multiple global extensions → **fail closed** (reject transaction, surface conflict, require explicit abductive branch or human/agent re-plan).
3. Cohomology in STP is diagnostic (“why plan fails”); in AODL it maps to **explicit obstruction codes** in the runtime, not silent repair.

**Fail closed** is the dual of STP’s geometric tolerance: geometry *permits* multiple sheaves; engineering *forbids* committing when glue data is incomplete.

---

## 3. Natural transformation = authorized mutation

### What STP says

- An action \(\alpha\) is \(\eta_\alpha : \mathcal{F}_{\text{World}} \to \mathcal{F}_{\text{World}}\) (natural transformation of sheaves over \(\mathcal{T}\)).
- **Naturality:** effect on a subinterval must match restriction of effect on a superinterval—temporal consistency for distributed / interrupted execution.
- Plans are **composition** of such transformations in the topos of sheaves.
- Unobserved external action is still a World transformation; Mem catches up via observation + abduction (pullback), not by redefining World.

### AODL operational reading

An **authorized mutation** is exactly a morphism that:

- Acts on **`F_World`** (and only through declared functorial rules propagates to derived views),
- **Preserves** the site structure (interval restrictions commute with the mutation),
- Is **allowed by policy** (capabilities, norms as constraint sheaves—not free-text model edits).

Unauthorized paths (direct JSON patch, LLM “fixing” Mem without World pullback, schema field twiddle) are **not** natural transformations; they must be rejected.

**Catalog language:** say “authorized mutation” / “natural transformation on World,” not “the model updated state.”

---

## 4. Catalog copy constraints (AODL-facing)

When describing STP-inspired behavior in product or agent docs:

| Do | Do not |
|----|--------|
| Name the three sheaves `F_World`, `F_Mem`, `F_Goal` consistently | Substitute `intent`, `plan`, `observed` as if they were the three objects |
| Explain observation as restriction / probe of World on an interval | Serialize a topos, site, or internal logic as JSON config |
| Explain planning as composing authorized World mutations | Claim “swarm inference” or peer gluing replaces explicit mutation + fail-closed glue checks |
| Use obstruction → fail closed, conflict surface, re-plan | Hide conflicts behind schema fields or implicit DB merges |
| Reference STP for **resilience narrative** (blind intervals, third-party change) | Require readers to know Grothendieck topology, HeytingLean, or cohomology to operate Dash |

**Explicit bans for catalog / UX / protocol copy:**

1. **No topos** — Do not expose topos, internal logic, or “mathematical universe” as a user-facing or wire type. Implementation may use sheaf *ideas*; public surface stays three functors + mutations + obstructions.
2. **No swarm inference** — Do not imply agents auto-merge beliefs by gossip or Laplacian consensus; multi-agent glue is a **verified** operation with fail-closed obstructions, not emergent hive mind.
3. **No schema fields** — Do not map `F_World` / `F_Mem` / `F_Goal` onto ad hoc JSON keys (`state`, `memory`, `goal` columns) as the ontology; schema holds **encodings** of sections, not replacements for the categorical objects.

**Do not JSON a topos:** Configuration files may list policies, allowed mutation labels, and obstruction handlers; they must not attempt to encode \((\mathcal{T}, \mathcal{J})\), \(\mathbf{Sh}(\mathcal{T},\mathcal{J})\), or Heyting semantics as structured data.

---

## STP mechanisms (compressed reference for implementers)

| STP construct | Planning meaning | AODL hook |
|---------------|------------------|-----------|
| Site \(\mathcal{T}\) | Intervals, inclusion, covers = causal patches | Time-indexed sections, not a single global clock variable |
| Sheaf axioms (locality, gluing) | Consistent histories | Mem/World sync rules |
| \(\eta : F_{\text{World}} \to F_{\text{World}}\) | Action | Authorized mutation |
| Pullback on state space | Abduction | Explain Mem vs observed without asserting false World |
| Non-trivial cohomology | No global plan | Fail closed + obstruction |
| \(F_{\text{Know}}\) gluing (swarm) | Peer merge of local sections | **Out of catalog** unless explicit verified merge API |

---

## One-line synthesis

STP separates **reality** (`F_World`), **record** (`F_Mem`), and **aim** (`F_Goal`) on a temporal site; **intent / plan / observed** are how Dash *talks about* commitment, composition, and sensing—they do not replace the triple. **Obstruction** means refuse to commit; **natural transformation** means the only legitimate change to reality is a policy-backed, restriction-commuting World mutation—never a topos in JSON, never swarm hallucination, never schema-as-ontology.
