# CoMPSeT (arXiv:2510.24205) → AODL `policies.choreo` vs message edges

**Source:** Ribeiro, Proença & Florido, *CoMPSeT: A Framework for Comparing Multiparty Session Types* ([2510.24205](https://arxiv.org/abs/2510.24205), EXPRESS/SOS 2025, EPTCS 433, pp. 46–64). **Tool:** browser CAOS instantiation — global-type input language, configurable **features**, projection, SOS animation, branching bisimulation (depth-bounded).

**AODL stance (HOTL 0.2):** \(O_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\); intent ≠ compiled plan ≠ observed \(O_t\); optional choreography under open `policies.choreo`; edge records stay closed (no session types on edges). CoMPSeT is a **comparison lens** on MPST variation points, not a scheduler or runtime IR.

---

## 1. What the paper actually compares (not Scribble / NuScr / ocaml-mpst)

CoMPSeT does **not** name or implement Scribble, NuScr, ocaml-mpst, or similar toolchain dialects. It parametrises a **single global/local syntax** (§2.1–2.2, grounded in Cledou et al. [5], Jongmans & Proença [17], and Daniélou & Yoshida [7]) and maps **five literature “base semantics”** via feature bundles (Table 1, §3):

| Preset in tool (§5) | Literature anchor | Feature snapshot (Table 1) |
|---------------------|-------------------|---------------------------|
| **VeryGentleIntroMPST** | Yoshida & Gheri [25] | plain **and** full merge; synchronous; no local parallel; fixed point |
| **GentleIntroMPAsyncST** | Coppo et al. [6] | plain merge; ordered asynchronous; no local parallel; fixed point |
| **APIGenInScala3** | Cledou et al. [5] | plain merge; ordered async; parallel ✓; well-channelled |
| **ST4MP** | Jongmans & Proença [17] | plain merge; ordered async; parallel ✓; Kleene star **and** fixed point (implementation uses star, §3) |
| **Non-Causal Asynchronous** (unordered model) | Guanciale & Tuosto [11] | communication model only (other columns N/S in Table 1) |

**Configurable features** (§3, §5.1): merge criteria (plain vs full), communication model (synchronous / ordered FIFO per pair / unordered multiset), parallel composition at global **and** local level, recursion scheme (µ vs Kleene `*`), extra well-formedness (well-channelled; tool adds well-branched for relaxed `GA + GB` syntax).

**Mapping onto AODL**

| CoMPSeT object | AODL placement | Message / delegation edges |
|----------------|----------------|----------------------------|
| **Global type** \(G\) (`p→q:{t_i; G_i}`, `;`, `∥`, `µ`, `*`, `skip`) — §2.1 | Optional **`policies.choreo.globalType`** (or named session body in open `policies.choreo`) | Edges declare **stable dyads** (`kind: message`, `from`, `to`) only; **order and labels** live in the global type, not on edge JSON (HOTL: `additionalProperties: false` on edges). |
| **Participant set** `participants(G)` — §2.2 | **`policies.choreo.participants`** (or role aliases → `V_t` node ids) | Each `p→q` in \(G\) must be realizable over declared message edges between those nodes (compile checks coverage, not inferred mesh). |
| **Feature / base-semantics tuple** — §3, Table 1, Settings widget §5.1 | **`policies.choreo.compSet`** (illustrative): `{ "merge": "plain"|"full", "communication": "sync"|"ordered-async"|"unordered-async", "parallel": bool, "recursion": ["mu","star"], "wellChannelled": bool, "preset": "APIGenInScala3"|"ST4MP"|... }` | Unchanged edge kinds; **semantics of checking** is selected at policy scope. |
| **Local types / projection** \(G⇂r\) — Fig. 3, §2.2 | **Compiled plan artifact** (per-node locals), not stored on edges | Validator projects global + profile; ⊥ if projection undefined (§1, §5.1 Locals/Check). |
| **Session delegation** (Bejleri & Yoshida [2]) — §2.1 remark | **Not in CoMPSeT grammar** (“constructs adopted are not extensive… session delegation established by [2]”). | AODL `delegation` edges remain **separate kind**; CoMPSeT offers **no** delegation construct — adapter must not pretend delegation is MPST `p→q` without an explicit choreo extension (swarm / unlabeled hybrid: compile ⊥, not inferred). |

**Evidence (global vs locals):** “The classical MPST framework… begins with the specification of a **global type**… From the global specification, **local types**… may be derived via a **projection** operation” (§1, Fig. 1). CoMPSeT’s input is “a **dedicated input language for specifying global types**” (§1 Contributions).

---

## 2. One dialect as THE profile vs comparison / adapter layer

**Paper-aligned choice: keep a comparison / adapter layer**, not a single frozen MPST dialect.

- **Explicit goal:** “support not only the comparison of distinct sessions under the **same** semantic but also of **semantics employing different formalisms**” (§1); “compare **two different semantics** within the same session” (§1 Contributions).
- **Features are modular:** “a **feature** as a modular aspect in the literature that can vary independently” (§3); “**base semantics** as the operational behaviour of our MPST syntax after selecting an explicit set of features” (§3).
- **Dialect disagreement is observable:** side-by-side semantics with bisimulation widget (§5.2, Fig. 9) — e.g. APIGenInScala3 vs ST4MP **bisimilar** for simple parallel delegation, but APIGenInScala3 vs unordered async **not bisimilar** after the same global type; plain vs full merge yields **defined vs undefined projection** for the same branching global (§5.2, Fig. 11).

**Fail-closed compilation (AODL reading, mirroring CoMPSeT Check / partial projection)**

1. **Profile required when `choreo` present:** If `policies.choreo` omits a resolvable feature tuple (or `preset`), do not default-merge literature — treat as **⊥** (same as “projection is a **partial function** undefined for global types that do not meet the conditions” (§1)).
2. **Projection ⊥:** Any role where Fig. 3 yields `undefined` (e.g. plain merge on `(pA→pB:TaskA ; pB→pC:TaskA) + (pA→pB:TaskB ; pB→pC:TaskB)` — §5.2) → **compile ⊥**, report undefined projection (tool: Locals/Check — §5.1).
3. **KP / Kleene star:** Assume “**KP-consistent** [4] global types” for `*` (§2.2 Remarks); star protocols whose projections are unsafe → reject under profiles that enable `*` (Charalambides et al. criterion referenced §2.2).
4. **Feature mismatch across document:** If intent declares preset A but edges/participants only realizable under preset B (e.g. global uses `∥` but `parallel: false`) → **⊥** (analogous to Check errors when operators disabled — §5.1, Fig. 8).
5. **Cross-preset attestation:** Do not silently equate presets; optional **dual-profile** check (like CoMPSeT bisimulation) is **evidence**, not automatic unification — disagreeing operational semantics ⇒ no single “observed-safe” label without explicit \(\Pi_t\) / harness contract.

**Do not** canonize e.g. ST4MP or Scribble as HOTL edge schema; encode **preset + features** under open `policies.choreo` and project fail-closed.

---

## 3. What AODL must NOT import from CoMPSeT

| CoMPSeT artifact | Why exclude from AODL IR |
|------------------|---------------------------|
| **CAOS widgets, SOS reduction rules, step-by-step animator, LTS/FSM UI** (§2.3, §4–5) | Operational **runtime / pedagogy**; AODL is typed IR + validator, not an SOS host. |
| **Branching bisimulation checker (depth 100)** (§4 footnote 4, §5.2) | **Analysis tool** output, not document truth; may inform CI, not \(O_t\) fields. |
| **JavaScript / browser deployment** (§1, §6) | Implementation surface, not wire schema. |
| **π-calculus–style process layer** (explicitly avoided: “Our semantics **deviate** from the standard approach, which typically relies on variants or extensions of π-calculus” — §2.3) | Process syntax is **not** the choreography declaration layer. |
| **API generation pipeline** (future work §7, citing [5, 17, 16, 18]) | Endpoint codegen is **downstream harness**, catalog-forbidden as language core. |
| **One Table-1 paper as the only legal schema** | Contradicts the paper’s comparative methodology (§3, §5). |
| **Aviation / MAVLink / RMPST** | **Not in 2510.24205**; [11] is pomset / communicating-automata **choreography** for unordered async motivation (§3 Remarks), not aerial protocols. Keep MAVLink/DATUM in separate research notes. |
| **Relaxed `GA + GB` as default syntax** | Tool extension for future choreographic languages (§5.1 Extra Requirements); AODL should not widen HOTL edge kinds to match without a version bump. |

CoMPSeT also **does not** import session delegation into its grammar (§2.1) — AODL should not collapse `delegation` into message labels by fiat.

---

## 4. Smallest fixture: 2-party bookseller-shaped document

CoMPSeT’s bundled examples are **controller–worker** and **parallel task delegation** (Examples 1.1, 2.1, §5.2), not the Pact/HasChor **bookseller** game. A **minimal 2-party bookseller-shaped** session in **CoMPSeT global syntax** (buyer `B`, seller `S`) — structurally the paper’s recursive offer pattern (cf. Example 2.1, §2.1) with commerce-flavored labels:

```text
µX. B → S : { Request ; S → B : { Quote ; B → S : { Accept ; S → B : Deliver ; X , Reject } , NoStock } , Quit }
```

**AODL shape (checkable without new edge fields)**

- **Vertices:** `node:buyer`, `node:seller` (roles in `V_t`).
- **Edges (closed records, kinds only):** one or two `message` edges `buyer ↔ seller` (dyad suffices; directionality is in global type).
- **`policies.choreo` (minimal):**

```json
{
  "choreo": {
    "notation": "compset-global",
    "globalType": "µX. B → S : { Request ; S → B : { Quote ; B → S : { Accept ; S → B : Deliver ; X , Reject } , NoStock } , Quit }",
    "participants": { "B": "node:buyer", "S": "node:seller" },
    "compSet": {
      "preset": "VeryGentleIntroMPST",
      "merge": "full",
      "communication": "sync",
      "parallel": false,
      "recursion": ["mu"],
      "wellChannelled": true
    }
  }
}
```

**Why these choreo fields (paper-backed):**

- **`globalType`:** sole carrier of send/receive order and branching (§2.1 `p→q:{t_i; G_i}`).
- **`participants`:** anchors projection \(G⇂r\) to graph nodes (§2.2, Fig. 3).
- **`merge: full`:** nested branches with different continuations after `Quote` require **full merge** for passive roles; plain merge fails when branches need incompatible merges (§5.2, Fig. 11 — same global, different merge ⇒ projection error).
- **`preset` / communication / parallel / recursion:** select **base semantics** before check (Table 1, §5.1); bookseller uses recursion (`µX`) not parallel `∥` — disable parallel to match profiles like [6]/[25] that lack local `∥`.
- **Omit `delegation` on edges** unless a separate AODL policy describes game/payment layer; CoMPSeT does not model delegation (§2.1).

**Fail-closed triggers for this fixture:** undefined projection under plain merge; KP violation if rewritten to `(…)*` without criterion (§2.2); `parallel: false` with `∥` in global; participant id not in `participants(G)`; message edges not connecting `B` and `S`.

---

## One-line catalog

*CoMPSeT is the feature-vector adapter for optional `policies.choreo`: one global type on policies, dyadic `message` edges only, compile ⊥ when projection or preset disagrees — not a dialect schema or runtime monitor.*
