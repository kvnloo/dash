# Evidence chain — high temperature, grounded

Status: **working capture**. Companion to [`thesis-intent-kardashev-20260912.md`](thesis-intent-kardashev-20260912.md) and [`thesis-shared-model-xrisk-20260912.md`](thesis-shared-model-xrisk-20260912.md). Not HOTL schema. Canonical promotion: frontier-kb `inbox/cursor/` → CoS → `literature/` / `permanent/`.

Rule: every high-temperature sentence in the thesis must survive this table. If a row has no math primitive **and** no SOTA paper, it is poetry. Keep the poetry in §0 of the other files; do not compile it.

Wire stays `hotl-0.2`. Readings, not kinds.

---

## 0. How to read a row

- **High-T** — the Arrival / Kardashev / movie sentence.
- **Math** — the object you could put on a blackboard.
- **Physics** — the constraint that does not care about our feelings (energy, causality, measurement).
- **SOTA** — a paper you can fetch. Prefer arXiv / journal over blog. Deep-read notes in [`deep/`](deep/) when we already did.
- **AODL slot** — existing tuple field or open `policies` / `constraints.budgets`.
- **Ground test** — what would make us drop the high-T reading.

Frontier-kb is the store because wikilinks are synapses: a claim that cannot be linked to a literature note should decay.

---

## 1. Chain

| High-T claim | Math | Physics | SOTA (fetchable) | AODL slot | Ground test |
|---|---|---|---|---|---|
| Intent is a **residual** \(\varepsilon\), not a prompt | Metric / distortion \(d(I,\mathcal{O}_t)\); Shannon rate–distortion \(R(D)\); Tishby IB \(\max I(Z;Y\mid Q)\) s.t. \(I(Z;H)\le B\) | Landauer: irreversible bit erasure \(\ge k_B T\ln 2\); finite-time Landauer sits **above** the bound ([2601.04358](https://arxiv.org/abs/2601.04358)) | Shannon 1948; Tishby et al. 2000; semantic RD [2604.09521](https://arxiv.org/abs/2604.09521); agent memory compaction as RD [2607.08032](https://arxiv.org/abs/2607.08032); RDKV water-filling [2605.08317](https://arxiv.org/abs/2605.08317); RLM slice [2512.24601](https://arxiv.org/abs/2512.24601) | \(\varepsilon_{\mathrm{codec/compile/run}}\); slice not dump; `constraints.budgets.tokens` | If dump beats slice on the **linear+quadratic** RLM strata at matched \(B\), the token-slice claim dies (still unrun) |
| Keyboard / image / video are **codecs**; loss is decoder-relative | Channel \(p(y\mid x)\); POVM / measurement as the decoder; ports as arity | You cannot extract a bit without an apparatus (measurement). No vision port ⇒ you did not measure the image | λ_A oracle/tool/`terminate` [2604.11767](https://arxiv.org/abs/2604.11767); CHI 2023 *capability-aware SMM* (He et al., task assignment); DeepSeek-style router is this row in the wild | \(\pi_v\): \(P(v)\) must include \(D(m)\) or bounded rewrite / \(\bot\) | Image payload + text-only plan must exit non-zero unless a vision child is declared |
| \(\mathcal{O}_t\) is a **simultaneous** logogram (Arrival) | Typed tuple \((V,E,S,\Pi,\Gamma)\); sheaf sections on a site; obstruction \(\Leftrightarrow\) no unique glue | Relativity: there is no global simultaneous “now”; a spec that is co-present is a **document**, not a spacetime slice. Causality still orders **runs** | STP sheaves [2605.01879](https://arxiv.org/abs/2605.01879); Chiang *Story of Your Life* is literature, not physics | Three objects; \(\tau\) decoder not compiler | If a silhouette can spawn, Arrival was a movie prop |
| Fail closed = **duality / coherence** | Linear logic (Girard); Curry–Howard; Honda session types; n-ary **coherence** (Carbone et al. MCP) | Conservation / gauge: you do not invent a current to close a circuit. Deadlock is a stuck worldline | Pact [2605.03143](https://arxiv.org/abs/2605.03143); rMPST legal-frame \(\neq\) legal-trace [2501.18874](https://arxiv.org/abs/2501.18874); CoMPSeT feature vector [2510.24205](https://arxiv.org/abs/2510.24205); mixed-choice MST [2602.23927](https://arxiv.org/abs/2602.23927) | `policies.choreo` optional; edges stay closed | A schema-valid MCP `tools/call` that is an illegal *sequence* must be rejectable by a profile |
| Smarter models, **shorter unlabeled** prompts are more dangerous | Posterior \(p(H\mid U)\) concentrates on the **model prior** as capacity \(\uparrow\); Goodhart; specification gaming | None required — this is statistics | Hubinger *Sleeper Agents* [2401.05566](https://arxiv.org/abs/2401.05566) (backdoors persist; larger models worse); Greenblatt alignment-faking; ICLR 2026 CoT obfuscation when monitored; AdaptOrch ε-convergence [2602.16873](https://arxiv.org/abs/2602.16873) | Unlabeled holes \(\Rightarrow \bot\); interrogation skills spend `humanAttention` | If unlabeled short prompts beat hole-marked docs at ε-convergent models, this dual is wrong |
| Kardashev: scale is **energy**, IR stays the tuple | Same \(\mathcal{O}_t\) for all rungs; budgets \(\in \Gamma_t\) | Kardashev 1964 (civilization by power); Landauer; Margolus–Levitin \(\Delta t \ge h/(4E)\); Bremermann ~\(10^{50}\) bits s⁻¹ kg⁻¹. **Practical** LLM energy is memory movement, not the Landauer floor | SweetSpot LLM energy model [2602.05695](https://arxiv.org/abs/2602.05695); thermodynamic EDP [2601.04358](https://arxiv.org/abs/2601.04358); Kaplan / Hoffmann scaling (compute as proxy for energy) | `constraints.budgets` already open; joules as a **profile** key, not a kind | If K1 requires new *kinds* rather than budgets/adapters, scale-invariance dies |
| Topology \(>\) model after quality converges | Variance decomposition; Lipschitz aggregation (AdaptOrch prop.) | None | AdaptOrch [2602.16873](https://arxiv.org/abs/2602.16873); Evo-Bench \(A_t=(\pi,H_t)\) [2608.09096](https://arxiv.org/abs/2608.09096) | Search **validated** programs; frozen \(\pi\) | Leaderboard-driven schema mutation is the anti-test |
| Shared mental model = **public three objects** | Aumann common knowledge; Lewis conventions; Cannon-Bowers SMM (task/team/equipment/interaction); transactive memory (Wegner) | Synchronization needs a **shared observable**, not telepathy | Mathieu et al. 2000 *JAP*; Vaccaro, Almaatouq, Malone 2024 *Nat Hum Behav* (Hedges’ \(g=-0.23\) human+AI vs best alone; **loss on decisions**, gain on creation); He et al. CHI 2023 capability-aware SMM; Tong review [2601.06030](https://arxiv.org/abs/2601.06030) (KEEP as review, SKIP “unitary agency”) | \(\mathrm{SMM}_t=(\mathcal{O}^{\mathrm{intent}},H_t,\mathcal{O}_t)\) | If a visible \(H\) still loses to the model-alone on gated judgment (Vaccaro), the document is a log, not a model |
| Inception: planted \(U\) ≠ declared \(I\) | Unforgeability; commitments; authentication | Totem = a measurement only one apparatus can pass | Sleeper agents [2401.05566](https://arxiv.org/abs/2401.05566); prompt injection as codec attack; rMPST stealthy-valid frames | Sign \(I\); totem \(\approx\) capability certificate | Planted utterance must not compile without a check |
| The Feed: dump into every skull | RD: recency/attention eviction fails when the query is **future** ([2607.08032](https://arxiv.org/abs/2607.08032) taxonomy) | Attention is a finite thermodynamic / cognitive budget | Oversight inverted-U [2606.08919](https://arxiv.org/abs/2606.08919); LiveMem continuity \(\neq\) \(\mathcal{O}_t\) [2608.02515](https://arxiv.org/abs/2608.02515) | Classified `stateStore` writes; `humanAttention` | Unclassified fan-out to every gate must \(\bot\) on budget, not “deliver the mundle” |
| Upload / stack / UI: copy sold as person | Three objects: observed state \(\neq\) intent | Destructive scan is irreversible (Landauer again: you erased the source) | Egan / Morgan are literature; Pantheon = Ken Liu; CodeCRDT 5–10% semantic residual [2510.18893](https://arxiv.org/abs/2510.18893); StateFuse ConflictSet [2607.05844](https://arxiv.org/abs/2607.05844) | Merge ≠ verify; no `upload` kind | Character-perfect merge must not count as intent satisfaction |
| Protomolecule: **someone else’s** \(H_t\) on our World | Functor applied on the wrong category; mesa-objective | Ring-builder plan is internally consistent and still lethal on complex life | Goal misgeneralization / mesa-optimization (literature); Expanse is the named hole; AgentSpawn bounds [2602.07072](https://arxiv.org/abs/2602.07072) | Unbounded spawn \(\bot\); foreign principal must be in \(\Gamma_t\) | A valid plan with the wrong principal must not run |
| Intelligence explosion | Recursive map \(H_{t+1}=E(H_t)\); Good ultraintelligent machine; dynamical blow-up | Energy/time bounds still apply to each step (Margolus–Levitin). Explosion is **software** until joules run out | Vinge 1993 NASA CP-10129 (IA vs AI); Evo-Bench early saturation [2608.09096](https://arxiv.org/abs/2608.09096); I.J. Good 1965 | `policies.dynamic` + cap; search stays fail-closed | Unbounded self-edit of IR from a bench score is the failure mode |
| Augmentation not replacement | Engelbart H-LAM/T (**L** = language); Licklider: human sets **criteria**; Shneiderman: high control **and** high automation | Deskilling is a slow x-risk (no new physics) | Licklider 1960 IRE; Engelbart 1962 AFOSR; Shneiderman HCAI; Vaccaro 2024; Weizenbaum 1976 | `humanGate` owns evaluation; machine owns bounded exec | If the human cannot withdraw \(I\), it is Pantheon |
| Recovered graph ≠ observed run | Static ADG vs dynamic trace | Code is not a worldline | AgentFlow [2607.01640](https://arxiv.org/abs/2607.01640); Hermes dry-run CLI (local) | Fail closed if ADG \(\not\models\) intent | Treating `agentenv/agentflow` as Wang et al. is a name collision, already recorded |

---

## 2. What is **not** in the chain (on purpose)

- IIT \(\Phi\), “machine consciousness,” Kardashev Type III as a kind.
- Dark Forest as \(\Pi_t\).
- clawRxiv / unvetted “Landauer meets LLM” sketches until they are arXiv with numbers we recompute.
- Tong’s “unitary symbiotic agency” as a schema goal.
- Netflix as evidence. Screen is a **named hole**, like λ_A’s missing `terminate`.

---

## 3. Frontier-kb write path

Cursor node writes **only** `inbox/cursor/`. CoS promotes to `literature/` (one note per primary) and `permanent/` (atomic claims in our words). Postgres on host 0 is the operational store (`kb_store.py ingest`); markdown is the Obsidian projection. This Dash folder is the review export when `cursor[bot]` cannot push `kvnloo/frontier-kb`.

Inbox ids minted this pass:

- `inbox-cursor-aodl-evidence-chain-20260912`
- `inbox-cursor-aodl-thesis-intent-20260912`
- `inbox-cursor-aodl-smm-xrisk-20260912`
- `inbox-cursor-aodl-deep-wave2-20260912`

Linear: [PER-1461](https://linear.app/0ism/issue/PER-1461).
