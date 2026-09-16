# HOTL legal discovery (arXiv:2606.19812) × AODL hotl-0.2

**Primary:** Sinha et al., *Human-on-the-Loop Orchestration for AI-Assisted Legal Discovery*, arXiv:2606.19812 (submitted 18 Jun 2026).  
**Read path:** `ddgs text` (arXiv hit) + Jina Reader `https://r.jina.ai/https://arxiv.org/html/2606.19812v1` (full section V–VII). Tavily not used.

**Scope:** Map the paper’s e-discovery HOTL orchestration onto existing AODL `humanGate`, evidence contracts, and \(\Gamma_t\) (`constraints` + gate policy). No new node kinds, no HOTL 0.3, no Dash `app/` edits, no remint of \(\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\).

---

## 1. Paper HOTL vs AODL `hotl-0.2`; orchestration → `humanGate` + \(\Gamma_t\)

### Name collision (do not merge)

| Token | Expansion / meaning | What it is |
|--------|---------------------|------------|
| **Paper “HOTL”** | **Human-on-the-Loop** — mandatory attorney escalation when verification layers fail or epistemic uncertainty exceeds \(\tau_{esc}\); cites Shneiderman’s human-centered AI framing ([9] in paper). | Domain orchestration pattern for **agentic e-discovery** (privilege review, FRCP audit). |
| **AODL wire `hotl-0.2`** | **Human-on-the-Loop orchestration language** (public name **AODL**): vendor-neutral typed IR for agent graphs, constraints, and human gates. | **Interchange spec**, not legal discovery product semantics. |

Same acronym, different objects. The legal paper is **prior art for escalation + trajectory verification**, not for the AODL language trademark or wire id.

### Paper orchestration (evidence from text)

1. **Problem:** *Trajectory collapse* — early misclassification in ReAct-style loops propagates; endpoint F1 misses fluency trap and tool hallucination along the trace (§I, Table I).
2. **Four verification layers** (§V), each tied to taxonomy stage:
   - **Planning validation** — \(f_{plan}\), solvability \(P(S \mid q, \mathcal{T})\); dispatch Execute vs **EscalateHOTL** when below \(\tau_{plan}\) (pilot \(\tau_{plan}=0.70\), ECE 0.04) (§V-A, Eq. 1).
   - **Stepwise reasoning checkpoints** — attribution \(A_t\); if \(A_t < \epsilon\) (pilot \(\epsilon=0.05\)), **discard trace and resample** from \(s_t\) (RRR metric); intercepts reasoning trap without always escalating (§V-B, Eq. 2).
   - **Execution sandboxing** — dry-run \(\delta(a)\); **Commit** iff **FRCPCompliant**(\(\mathcal{S} \oplus \delta(a)\)); deny-list (Attorney Eyes Only routing, court-auth exports, post-deadline privilege-log edits); failed check → **HOTL escalation**, not proceed (§V-C, Eq. 3).
   - **Uncertainty-gated escalation** — epistemic term \(U_{\text{ep}}\) via self-consistency (k=10); when \(U_{\text{ep}} > \tau_{esc}\), **mandatory HOTL**: suspend autonomy, surface full trajectory state to attorney (§V-D, Eq. 4; pilot ECE 0.06, Brier 0.11).
3. **HOTL integration** (§VII): escalation surface is *surfaces-not-decides* — document, reasoning trace, uncertainty trigger, suggested classifications with CIs; attorney retains judgment.

Simulation (§VI): **Threshold-HOTL** at \(\tau_{esc}=0.5\) cuts Privilege-Waiver Risk (PWR) 8.3% → 3.2% (~61% relative) with **Escalation Rate (ER) 23.7%** vs fully autonomous; reasoning checkpoints yield mean **RRR ≈ 0.71**; mean **FEP 3.2** steps on ~7.8-step trajectories for autonomous runs.

### AODL mapping (no new kind)

| Paper mechanism | AODL surface | Notes |
|-----------------|--------------|--------|
| EscalateHOTL / mandatory HOTL / sandbox fail | Existing **`humanGate`** node on **`control`** or **`verification`** edges (profile: `human_gate` in `policies.kinds`) | Attorney ≡ any declared human executor; not a fifth layer kind. |
| \(\tau_{plan}\), \(\tau_{esc}\), \(\epsilon\), calibration policy | **\(\Gamma_t\)** — `constraints` (goals, verification, termination) + open **`constraints.budgets`** | Thresholds and “monthly recalibration” (§VII) are **declared policy**, not observed metrics. |
| Planning / reasoning / execution / UQ interceptors | **`verification`** edges + tool/sandbox **`environment`** nodes + **`policies`** (critic, retry) | Layers are **compiler/runtime profile** over existing relations; mirror AgentFlow “required guards” reading, not `planningValidator` enum. |
| Trajectory integrity (FEP, RRR, PWR, ER) | **Observed** \(S_t\) + **receipts** on `observation` / event log | Endpoint metrics the paper criticizes stay out of \(\Gamma_t\); FEP/RRR prove *where* failure was caught. |
| Surfaces-not-decides payload | **Evidence contract** on gate enqueue (profile + Keel-style hooks) | Document + trace + uncertainty + suggestions are **gate context**, not new JSON vertex types. |

**Keel** stays named Keel: L0 “router is not an agent of the project” is orthogonal to attorney privilege review; do not rename Keel to match legal HOTL.

---

## 2. Evidence layers, privilege, audit — \(\Gamma_t\) vs receipts

### Declare in \(\Gamma_t\) (intent / constraints)

From HOTL 0.2 spec: \(\Gamma_t\) holds objective, acceptance, privacy/capability constraints, **declared budgets**, **evidence / review / HITL gates**, failure/escalation, termination ([`hotl-0.2.md`](file:///tmp/research/aodl/spec/hotl-0.2.md) §Safe operational core). For a **legal-discovery compiler profile** (adapter, not core schema):

- **Verification policy:** which stages require intercept (plan solvability, step progress floor, sandbox commit rule, epistemic threshold); initial \(\tau_{esc}=0.4\) recommendation and recalibration cadence (§VII) as **declared** thresholds, not runtime ECE.
- **Human gate policy:** mandatory escalation on sandbox failure and on \(U_{\text{ep}} > \tau_{esc}\); planning dispatch EscalateHOTL — all **`humanGate`** draws, optionally attributed on edges (`budget.draw`).
- **Budgets (schema-legal):** e.g. cap concurrent attorney escalations via **`constraints.budgets.humanAttention`** (open object); separate from paper’s **ER** statistic (observed fraction of documents escalated).
- **Privilege / FRCP:** **deny-list and compliance predicates** belong in **profile + sandbox policy**, not as first-class HOTL node kinds or global schema enums (Attorney Eyes Only, work-product subclasses, production deadlines).

### Observe in receipts / event log (not substituted for \(\Gamma_t\))

Paper §VII **audit trail:** each interaction unit \((c_t, a_t, o_t)\) logged with **deterministic provenance hash** — trace privilege classification to retrieved passage and reasoning step (FRCP auditability).

Runtime must emit:

- Escalation **trigger** (plan fail, sandbox fail, \(U_{\text{ep}}\) breach vs resample-only checkpoint).
- **Reasoning trace**, retrieved spans, self-consistency label distribution / \(U_{\text{ep}}\).
- **Suggested classifications + CIs** (surfaces-not-decides); attorney decision as sealed gate outcome.
- Simulation metrics **PWR, ER, FEP, RRR** and calibration **ECE/Brier** — evaluation and monitoring only.

**Privilege labels** (attorney-client vs work-product) are **domain ground truth** in the legal corpus/profile; AODL records **evidence pointers and gate decisions**, not malpractice law in the wire format.

---

## 3. Captain flooding / inverted-U reviewer load

**Paper:** Treats human review as a **cost–risk tradeoff**, not a cognitive-capacity model. ER is a **reported outcome** (23.7% documents at \(\tau_{esc}=0.5\)); they argue efficiency vs fully manual (~76% attorney-hour reduction at comparable PWR) and defer a **“full throughput study with real attorney cohorts”** (§VI-C). They do **not** discuss reviewer fatigue, flooding attacks, inverted-U oversight safety, concurrent pending escalations, or captain-style continuous loops.

**AODL alignment (separate literature):** Captain flooding and inverted-U attention are documented against [arXiv:2606.08919](https://arxiv.org/abs/2606.08919) in `docs/research/deep/craid-attention.md` — **`humanGate` + `constraints.budgets.humanAttention`**, fail closed when pending draws exceed cap. The legal paper **supports** declaring \(\tau_{esc}\) and measuring ER; it does **not** justify omitting `humanAttention` when multiple verification paths fan into the same gate. Import the **threshold + layer** insight from 2606.19812; import **capacity ceiling** from 2606.08919 / CRAID profile, not from the legal paper’s text.

---

## 4. What AODL must NOT import

| Do not | Why (paper- or process-faithful) |
|--------|----------------------------------|
| **Rename Keel** | Keel is capability/evidence/HITL identity in this network; legal HOTL is attorney privilege workflow — related gate *pattern*, different product contract. |
| **Legal-domain schema fields** | FRCP deny-list rules, privilege tags, “Attorney Eyes Only,” privilege subclasses, e-discovery SDK scopes — **profile/adapter**, not `hotl-0.2` closed node/edge enums. |
| **Treat paper as prior art for AODL / `hotl-0.2` name** | Wire id and AODL acronym denote **orchestration IR**; paper HOTL denotes **high-risk legal IR orchestration**. Catalog as reading, not nomenclature merge. |
| **New kinds for four layers** | §V layers map to verification + sandbox + `humanGate`; no `planningValidator`, `uncertaintyGate`, or HOTL 0.3 kinds. |
| **Remint \(\mathcal{O}_t\) or collapse intent/plan/observed** | Trajectory state surfaced to attorney is **observed** + gate context; thresholds live in \(\Gamma_t\); compiled interceptors in plan profile. |
| **Escalate-everything as default D-phase** | Paper shows calibrated threshold beats autonomy; 2606.08919 (not this paper) warns more escalation can reduce safety — use budgets. |
| **Endpoint F1 as assurance** | Paper explicitly rejects endpoint-only metrics for agentic legal IR; do not encode F1 as \(\Gamma_t\) acceptance alone. |

Also out of scope per task: Dash `app/` edits; minting HOTL 0.3; payment/escrow for attorney time.

---

## Sources (in-paper anchors)

- Trajectory collapse, fluency trap, taxonomy Table I: §I, §IV.
- Four layers + equations (1)–(4): §V-A–V-D.
- T-HOTL simulation, PWR/ER/FEP/RRR: §VI.
- Escalation UI + provenance audit + \(\tau_{esc}\) calibration: §VII.
- ORCHID cited for evidence-first HOTL + audit logging ([14]); distinction: paper adds FEP/RRR trajectory-integrity metrics (§III).

**Catalog one-liner:** Legal-discovery HOTL is a calibrated four-layer intercept plus `humanGate` escalation for privilege trajectories; AODL expresses it with existing gates, \(\Gamma_t\) thresholds/budgets, and observed provenance receipts—without adopting the paper’s acronym as the language name or Keel’s rename.
