# Deep read: Qoreo (arXiv [2607.20391](https://arxiv.org/abs/2607.20391))

**Confirmed title:** *Qoreo: Choreographic Programming for Quantum Distributed Systems* — Jennifer Paykin, Steven Baldasty, Joseph P. Near, Christian Skalka (University of Vermont). **arXiv:2607.20391** [quant-ph], v1, 22 Jul 2026. (The id is correct; this is the 2026 choreographic / session-types-lineage paper for distributed **quantum** protocols, not a mislabeled classical-agent paper.)

**Sources:** arXiv abstract + HTML (`2607.20391v1`) via Jina reader; joined to [pact.md](./pact.md) and [rmpst-refinements.md](./rmpst-refinements.md) without contradiction.

**Thesis (paper):** Distributed quantum protocols are tedious and error-prone as hand-written processes (deadlock from missing/wrong-order classical messages; **silent** wrong quantum state from mismatched expectations). Qoreo is a **choreographic programming language** with a **linearly typed** local quantum calculus, a **global choreography**, **endpoint projection (EPP)** to per-node processes, **mechanized** metatheory in Rocq, and an **extraction pipeline to NetQASM** for simulation/hardware.

---

## 1. What Qoreo is — global type vs local projection vs AODL `message` / `delegation`

| Artifact | Qoreo | AODL (HOTL 0.2) |
|----------|--------|------------------|
| **Kind** | **Language + calculus + tool chain** — not a wire IR. Three layers: (1) local quantum λ-calculus (Selinger–Valiron), (2) choreographic language, (3) untyped process language for networks. | Typed **IR** document; `message` / `delegation` edges are **sessions**, not pipes. |
| **Global** | One **choreography** — list of instructions over named **actors** (`Alice`, `Bob`, …): local `let A.x = e`, classical send `A.e ↝ B.x` (surface: `A.x ~> B.x`), entanglement `A.x ↭ B.y` (surface: `A.a <~> B.b`). **No** conditional choreographies in the core syntax (omitted to avoid knowledge-of-choice issues; future work §10.1). | Declared interaction skeleton in \(\mathcal{O}^{\mathrm{intent}}\); optional **global session contract** under **`policies`** (open object), **never** on edges (`additionalProperties: false`). |
| **Local** | **EPP** filters the global program per actor into `send` / `receive` / `entangle with` / local `let` processes (Fig. 2 vs Fig. 3). Process language **has no separate type system**; safety is inherited from well-typed choreographies + EPP (§5.2). | Per-node **compiled plan** + harness projection from the declared graph. |
| **Typing** | Choreographic judgment \(\bar\Gamma; \bar\Delta; \bar\Theta \vdash C\) with per-actor classical, **linear**, and **qubit-reference** environments; send rule requires **duplicable classical** `!τ`; qubits move only via **entangle**, not classical channels (Fig. 8). | Per-message JSON Schema (MCP/A2A) = legal **message**; optional `policies.choreo.globalType` (+ rMPST-style refinements) = legal **sequence**. |

**Paper evidence (global vs local):** “entire protocol is expressed as single, global program (a choreography) rather than as a collection of independent actor processes”; EPP “automatically derives a network of independent processes”; teleportation choreography (Fig. 3) vs Alice/Bob processes (Fig. 2).

**Alignment with Pact / classical MPST:** Same **global choreography → endpoint projection** split as Pact’s cooperative bookseller layer and rMPST’s global type — Qoreo explicitly cites Carbone–Montesi choreographies and multiparty session types (§9.1): global view vs verbose per-channel session types.

**Distinction from AODL three-object rule (unchanged):** Qoreo source text is **executable choreography**, not \(\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\). It informs **optional `policies.choreo`** and **compiler profiles** that check `message`/`delegation` skeletons; it does **not** replace intent, compiled plan, or observed trace.

---

## 2. What Qoreo adds beyond Pact + rMPST (for AODL compiler profiles)

**Already covered by joined notes (Qoreo does not supersede):**

- **Pact [2605.03143]:** Cooperative choreographic **structure** + **deadlock-free projection**; plus **strategic** `choose`, `values`, `world` → formal **games** and “why follow?” analysis. Qoreo is **fully cooperative** choreography: “every participant’s behavior is fully determined” (§9.1); **no** utilities, nature, or game layer.
- **rMPST [2501.18874]:** MPST skeleton + **boolean refinements** on payloads and **protocol variables** (`curr`, coupled params) for **classical** trace safety. Qoreo’s global type specifies **communication shape and quantum linear discipline**, not arbitrary cross-step payload predicates like mission `curr` vs `N`.

**What Qoreo adds (paper-faithful, relevant to profiles):**

| Addition | Content | AODL compiler-profile reading |
|----------|---------|-------------------------------|
| **Linear choreographic types** | “Novel linear type system for choreographies” — disjointness on linear/qubit envs at `entangle`/`let`; classical vs quantum comm **separated** (send only `!τ`; qubits via entanglement). Paper claims first integration of **linear types with choreographies** (§2.3). | Reinforces **session discipline** at compile time, but for **qubit linearity** and **no-cloning** — not for MCP tool args. Classical agent `message` profiles stay **Scribble/NuScr/ocaml-mpst + optional rMPST refinements** on `policies.choreo`. |
| **Quantum semantics** | Density-matrix semantics; type safety ⇒ “well-defined quantum operations” (Theorems 3.8, 4.8), not only communication matching. | **Out of scope** for default HOTL agent graphs unless a future profile names quantum participants explicitly. |
| **EPP soundness + completeness** | Theorems 6.2, 6.5: choreographic steps ↔ network steps; Corollary 6.6 **network safety** (no comm deadlock, no “stuck” in the choreographic sense). | Same **adapter contract** as classical choreo: successful projection is the positive case; **disagreement → ⊥** when global type cannot project (cf. rMPST attestation). |
| **Mechanization + extraction** | Full formalization in **Rocq**; renderer runs EPP and emits **NetQASM** Python per participant (§7). | **Reference implementation pattern** for a `policies.choreo.profile: "qoreo"`-style backend — **not** something AODL embeds in the document. |
| **Explicit non-features (today)** | No knowledge of choice in core syntax (§4); dynamic spawn called a limitation (§9.1); noise out of scope (§10.3). | Pact’s branching/`broadcast` and rMPST guarded choice are **richer control-flow** than current Qoreo core; agent orchestration still needs Pact+rMPST for games and payload refinements. |

**Net for profiles:** Qoreo **confirms** the continuous-insights line: a **global protocol excludes unsafe sequences**, not only illegal isolated messages — here extended to **classical-order** bugs (deadlock) and **quantum-state** bugs (wrong order ⇒ wrong state without runtime error). For classical AODL, treat Qoreo as **cross-domain evidence** for optional `policies.choreo` + EPP-backed attestation, while **Pact** supplies \(\Pi_t\) game readings and **rMPST** supplies refinement lists — neither is replaced.

---

## 3. Deadlock-freedom / fail-closed duality — Pact-class invariant or new?

**Same core invariant as classical choreographies and Pact’s MPST layer:**

- Abstract: “every well-typed choreography projects to a **deadlock-free** process network.”
- Corollary 6.6 (`Qoreo.Network.safety`): for \(\emptyset;\emptyset;\bar\Theta \vdash C\) and well-formed \(\rho\), any reduction of \(\llbracket C \rrbracket\) ends in a **terminal** network (all `0`) or can **still step** — in particular **no communication deadlock**.
- EPP correctness is the mechanism Pact already assumes: “Concretely, the projected network is deadlock-free because the choreography is” (Qoreo §1, same slogan as Carbone–Montesi).

**Fail-closed dual (AODL-compatible, not a new HOTL kind):**

- **Typability required:** “projection alone does not guarantee semantic safety (not getting stuck)” (§6) — raw EPP without a well-typed choreography is insufficient.
- **Well-formedness:** no self-communication; typing implies well-formedness (Lemma 6.1).
- **Reject before run:** ill-typed / non-projectable global program ⇒ do not deploy — mirrors AODL **⊥** on failed dualization/projection (pact.md §3, rmpst §3 item 4).

**Strictly additional guarantees (quantum, not a replacement for comm duality):**

- Choreographic **type safety** (Theorem 4.8): well-typed configs are **not stuck** on the choreographic semantics — covers **cloning, wrong classical/quantum kind, linear misuse**, not only unmatched send/receive.
- **Silent classical-order bugs** are classified as deadlock or wrong-state; rMPST-style **value refinements** are still the layer for “each frame legal, sequence unsafe” on **classical agent** payloads.

**Verdict:** For `message`/`delegation` **session structure**, Qoreo is the **same deadlock-free projection invariant** as Pact’s cooperative choreo, not a second duality law. Fail-closed compilation remains the **compiler mirror**. Qoreo adds a **parallel** “quantum well-definedness” obligation that AODL does not import unless profiling quantum sessions.

---

## 4. What AODL must **NOT** import from Qoreo

| Do not import | Paper basis / reason |
|---------------|----------------------|
| **NetQASM (or Rocq→Python) as a second choreography runtime** | Qoreo’s deployment path is extraction to **NetQASM SDK** applications per actor (§7). AODL keeps **bridge / Hermes / Dash harnesses**; optional **attestation at adapters**, not a bundled quantum simulator. |
| **Qubit, entanglement, and linear types as edge or payload schema** | Types: `bit`, `qubit`, `!τ`, linear functions, qubit-reference maps \(\bar\Theta\). These are **domain physics**, not MCP/A2A JSON Schema. Do not hang quantum payload types on closed `message` edges. |
| **Entanglement / quantum send as new HOTL edge kinds** | Primitives `↭` / `<~>` vs classical `↝` / `~>`. **No HOTL 0.3 kinds** — classical `message`/`delegation` remain the wire session kinds. |
| **Density-matrix semantics or no-cloning as document policy** | Semantic model for **quantum** correctness (§2.1–2.3). Not interchangeable with rMPST refinements on orchestrator task state. |
| **Qoreo choreographies as authoritative \(\mathcal{O}_t\)** | Same three-object rule as Pact: global Qoreo text ≠ observed NetQASM trace; intent ≠ compiled plan ≠ run. |
| **Cooperative “fully determined actor” model for strategic agents** | §9.1: choreographies “leave no room for actor autonomy” — opposite of Pact’s strategic layer; do not drop \(\Pi_t\) game policies in favor of Qoreo’s cooperative default. |
| **Vendor Haskell/Rocq** | Mechanization is Rocq on GitHub; AODL validators stay in-repo Python/TS — cite the **theorems**, do not vendor the proof assistant. |

**Keep (adapter only):** Optional `policies.choreo` global type + EPP-shaped projection checks for **classical** `message` skeletons; cross-domain citation that global typing rejects **ordering** failures; profile hook naming aligned with other choreo backends — without quantum runtime or linear qubit types in the core IR.

---

## References

- [2607.20391](https://arxiv.org/abs/2607.20391) — Qoreo: choreographic language, linear types, EPP, Rocq, NetQASM.
- Joined: [2605.03143](./pact.md) (Pact), [2501.18874](./rmpst-refinements.md) (rMPST / `policies.choreo`).

---

## One-line catalog

*Qoreo mechanizes global-to-local quantum choreography and the same deadlock-free EPP invariant Pact and rMPST assume for classical sessions; AODL may adopt only the optional `policies.choreo` projection pattern, not NetQASM, qubit types, or a second runtime.*
