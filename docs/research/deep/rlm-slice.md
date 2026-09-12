# RLM (arXiv:2512.24601v3) — deep read for AODL slice vs dump

**Source:** Zhang, Kraska, Khattab, *Recursive Language Models* (May 2026 v3). Full text extracted from arXiv PDF (43 pp). Jina on `arxiv/html` and `ar5iv` returned stubs only.

**Scope:** Map RLM’s “prompt as environment” loop to HOTL’s observed graph \(\mathcal{O}_t\); sharpen the slice-vs-dump falsifier against the paper’s actual benchmarks; **do not** treat RLM as evidence for a conservative dynamic-graph interchange IR.

---

## 1. Prompt-as-environment algorithm (paper-faithful)

RLM is an **inference-time scaffold** around a base LM \(M\) with context limit \(K\). The user prompt \(P \in \Sigma^\*\) is **not** fed wholesale into \(M\); it lives in a persistent **REPL environment** \(E\) as a symbolic value the model manipulates via generated code.

### Algorithm 1 (core loop)

1. **Init:** `state ← InitREPL(prompt=P)`; register `sub_RLM` (recursive calls to \(M\) or nested RLM).
2. **Root context:** `hist ← [Metadata(state)]` only — length, short prefix, how to index/slice \(P\) (constant-size w.r.t. \(|P|\)).
3. **Iterate until `Final` is set:**
   - `code ← LLM_M(hist)`
   - `(state, stdout) ← REPL(state, code)` — Python REPL in the implementation; tools/sub-LMs as modules.
   - `hist ← hist ∥ code ∥ Metadata(stdout)` — **not** full stdout; truncated metadata so the root window is not polluted.
4. **Return:** `state[Final]`.

### Three design choices (vs “Algorithm 2” strawman)

| Choice | RLM (Alg. 1) | Weak scaffold (Alg. 2) |
|--------|----------------|-------------------------|
| Where \(P\) lives | Variable in \(E\); symbolic handle | \(P\) copied into `hist` → compaction/heuristics |
| Output | Accumulated in REPL variables + `Final` | `Finish` action → bounded by \(K\) |
| Recursion | **Programmatic** `sub_RLM` inside loops over slices of \(P\) | Verbalized sub-calls only; no \(\Omega(|P|)\) or \(\Omega(|P|^2)\) work |

### Implementation notes (§3.2)

- Python REPL; initial prompt as string variable; sub-LM as importable module.
- GPT-5 runs: root **GPT-5**, recursive sub-calls **GPT-5-mini**; max recursion depth 0–3 (depth 0 = no sub-calls, still has REPL offload).
- Root iterations bounded in practice by \(K/c\) if each turn trims to \(c\) tokens; sub-calls can be many per iteration.

**What this is not:** not a wire protocol, not a typed orchestration IR, not separation of intent / compiled plan / observed runtime. It is a **single-string in, single-string out** inference pattern with external program state.

---

## 2. Slicing \(\mathcal{O}_t\) (nodes + edges + receipts) vs dump

HOTL observed graph: \(\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\) plus append-only **event log / provenance** (“receipts”). RLM’s analogue is **not** the graph itself but the **same information-theoretic move**: treat large structured state as an **external object** and pass **handles + metadata** into the LM, not a serialized dump.

### RLM mapping

| RLM mechanism | AODL / \(\mathcal{O}_t\) analogue |
|---------------|-----------------------------------|
| `P` in REPL variable | \(\mathcal{O}_t\) (or a projection) held outside the model window — store, DB, event log, compiler artifact |
| `Metadata(state)`, truncated `stdout` | Per-turn **slice descriptor**: node ids, edge types, time range, hash of snapshot — not full JSON |
| Code that indexes/splits `P` | **Query slice**: subgraph \((V', E')\), incident receipts, policy-facing fields only |
| `sub_RLM(slice_prompt)` | Node-local or bounded-hop **oracle call** with typed ports (matches \(\lambda_A\) / message edges), not re-pasting the whole graph |
| `Final` in REPL | Answer or **mutation plan** committed after sufficient evidence, not chat completion from a dump |

### Dump (what RLM argues against)

- **Algorithm 2 / CodeAct (no offload):** entire user prompt in `hist` → same as dumping `intentGraph` + full `observedGraph` + recent `eventLog` into context.
- **Compaction agent:** lossy summarization when `Tok(hist) > K` → analogous to periodic “canonical summary” of \(\mathcal{O}_t\) without addressable receipts; fails when **dense** access is needed (paper: OOLONG, OOLONG-Pairs).
- **Coding agents with file offload only:** context in a file but model still **ingests chunks into window** without programmatic \(\Omega(n)\) or \(\Omega(n^2)\) sub-work — partial offload, not slice-query discipline.

### Slice (what AODL should compile/runtime enforce)

1. **Addressable identity:** nodes/edges/events by stable id + schema version (RLM: string indices, regex, chunk ids on `P`).
2. **Bounded hop / fan-in:** each LM call gets \(V' \cup \partial E' \cup\) receipts that **justify** those endpoints (RLM: one sub-call per chunk or pair program).
3. **Distortion signals:** missed dependency = wrong edge/receipt omitted; stale state = slice time/domain mismatch — paper’s failure mode for compaction and base-LM on OOLONG-Pairs (F1 \(\leq 0.1\%\) vs RLM 58% GPT-5 depth=1).

**Receipts** are the anti-compaction anchor: RLM does not use cryptographic receipts, but **stdout truncation + variables** play the same role as “prove you read the right span before `Final`.” For HOTL, receipts should be **event-log pointers** (nonce, evidence, OTel span ids), not prose summaries.

**Interchange boundary:** RLM shows that **offload + programmatic recursion** beats **dump + summarize** on long dense prompts. That supports the *engineering hypothesis* that \(\mathcal{O}_t\) should be queried, not pasted. It does **not** specify ports, authority, MPST, or fail-closed compilation — those remain AODL’s separate claim.

---

## 3. Falsifier refinement (was: 24 probes, dump wins ≥15pp @ matched \(B\))

**Draft (continuous-insights):** 24 paired probes; if **full dump** beats **slice** by \(\geq 15\) percentage points at matched token budget \(B\), the token-slice hypothesis dies. Do not cite RLM as proof of interchange.

### What the paper actually evaluates

| Benchmark | \(n\) | Prompt scale (typical) | Complexity vs length | Metric |
|-----------|------|-------------------------|----------------------|--------|
| S-NIAH | 50 | \(2^{13}\)–\(2^{20}\) tokens | \(O(1)\) needle | Score (%) |
| BrowseComp-Plus (1K docs) | 150 | 6M–11M tokens | constant # docs, multi-hop | **% correct** |
| OOLONG (`trec_coarse`) | 50 | ~131K | **linear** (use almost every line) | Score (%) |
| OOLONG-Pairs | 20 | ~32K | **quadratic** (pairs of chunks) | **F1** (list answer) |
| LongBench-v2 CodeQA | (set) | 23K–4.2M | fixed # files | **% correct** (MC) |

**Baselines paired with “dump” flavor:** base model (full context), CodeAct with \(P\) in LM context (+ BM25 or sub-calls), compaction agent. **“Offload but not RLM”:** OpenCode / Claude Code with context offloaded to file. **Slice + recurse:** RLM depths 0–3.

**Headline deltas (GPT-5, Table 1, depth=1):** e.g. OOLONG 44% → 56% (+12pp); OOLONG-Pairs F1 0.1% → 58%; BrowseComp+ 0%* → 91.3%; CodeQA 24% → 62%. Abstract **median relative gains** vs compaction (+26%), CodeAct+sub-calls (+130%), Claude Code (+13%) — relative, not uniform +15pp on every task.

**Cost constraint:** paper reports **mean API cost ± std** per task; claims “comparable or cheaper” median vs baselines (Figure 11 quartiles). Falsifier should match **\(B\)** on **tokens + dollars**, not tokens alone.

### Refined AODL falsifier (aligned to RLM eval structure)

**Hypothesis (HOTL §86):** canonical **query slices** of \(\mathcal{O}_t\) + receipt pointers beat **full dump** (or lossy summary) above a break-even graph size / mutation rate.

**Design:**

1. **Stratify \(n = 24\) probes** by dependency complexity (mirror paper’s three regimes):
   - **8 × \(O(1)\)-local:** single-node tool/read; answer depends on one receipt (S-NIAH / local tool analog).
   - **8 × linear:** answer needs **most nodes** in a chain or fan-in (OOLONG analog) — e.g. aggregate status across 10+ tasks.
   - **8 × quadratic / pairwise:** answer needs **many cross-edge pairs** (OOLONG-Pairs analog) — e.g. pairwise consistency of `message` edges + evidence.

2. **Conditions (paired on same instance):**
   - **Dump:** serialize full \(\mathcal{O}_t\) + last \(k\) events (or compaction-style rolling summary at same \(B\)).
   - **Slice:** compiler/runtime serves **id-bounded subgraph + receipt handles** only; model may issue bounded queries (RLM-style) with same global \(B\) cap.

3. **Primary metric (per stratum):** **task success rate** (% correct for scalar/boolean; **F1** or set overlap for list answers — match OOLONG-Pairs).

4. **Secondary metrics (distortion):** **missed-dependency rate**, **stale-state errors** (wrong time slice), latency, cost — paper’s implicit distortion is catastrophic failure on OOLONG-Pairs (near-zero F1) under dump/compaction.

5. **Kill rule (refined):** On the **linear + quadratic strata combined** (16 probes), if **dump** (or compaction-at-\(B\)) exceeds **slice** by **≥15pp** on primary metric **at matched \(B\)** (pre-registered token + cost ceiling), reject the slice claim for orchestration contexts at that scale. Optionally report **per-stratum** thresholds: quadratic stratum alone is where RLM shows the largest gap (F1); a 15pp rule there is **stricter** than on S-NIAH-like locals, where offload-without-recursion sometimes wins (CodeQA: RLM depth=0 66% vs depth=1 62% on GPT-5).

6. **What RLM does *not* supply:** no fixed \(n=24\), no 15pp constant in the paper — those stay **AODL pre-registration**. RLM supplies **task families**, **metrics**, and **baseline taxonomy** (dump vs offload vs offload+programmatic recurse).

---

## 4. RLM does **not** prove interchange

| RLM establishes | AODL interchange requires |
|-----------------|---------------------------|
| Long **string** prompts can be processed via REPL + recursive \(M\) | Typed **graph** IR, intent ≠ plan ≠ \(\mathcal{O}_t\) |
| Task-agnostic inference scaling | Vendor-neutral **compilation**, fail-closed adapters (MCP, A2A, MPST, …) |
| Python REPL + sub-LM calls | **Authority**, budgets, human gates, evidence nonces |
| Empirical wins on 4 benchmarks | **Replayable** event log and port multiset witnesses |

**Safe citations:** RLM is **adjacent research** for the token-slice / rate–distortion story (prompt as external object; programmatic sub-calls over spans). **Unsafe:** “RLM validates dynamic-graph interchange,” “RLM is prior art for HOTL,” or “RLM proves \(\mathcal{O}_t\) should replace context windows” — the paper never defines orchestration graphs, receipts, or cross-runtime compilation.

**One-line:** RLM is a **reference implementation of slice-over-dump for a single prompt variable**; HOTL still owes a **measured** slice-vs-dump benchmark on \(\mathcal{O}_t\) with the falsifier above — orthogonal to whether the IR compiles across harnesses.

---

## References

- Paper: https://arxiv.org/abs/2512.24601 (v3); code: https://github.com/alexzhang13/rlm  
- AODL draft falsifier: `workspace/docs/research/continuous-insights-20260911.md` (24 / 15pp / matched \(B\))  
- HOTL token hypothesis: `tmp/research/aodl/spec/hotl-0.2.md` §86  
- C(RAID) guardrail: do not claim RLM proves interchange — `tmp/research/aodl/docs/research-craid-20260911.md`
