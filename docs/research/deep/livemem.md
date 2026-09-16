# LiveMem (arXiv:2608.02515v2) — deep read for AODL memory continuity

**Source:** Liu et al., *LiveMem: Maintaining Memory State Continuity in Long-Running LLM Inference* (arXiv:2608.02515v2, 7 Aug 2026). Full text from arXiv PDF (22 pp). Abstract cross-checked via `ddgs` + `https://r.jina.ai/https://arxiv.org/abs/2608.02515`.

**Wire:** `hotl-0.2`. **Flag (catalog):** memory continuity ≠ observed graph. **Do not** add HOTL 0.3 kinds or remint \(\mathcal{O}_t\).

---

## 1. Continuity mechanism — map to `stateStore` / \(\Gamma_t\) / node-local mem

LiveMem is **not** one mechanism; it is **architecture + turnover policy + post-training + serving** that makes a **fixed-capacity recurrent memory state** load-bearing after tokens leave the attention window.

### What the paper actually uses

| Mechanism | Role in LiveMem (paper) | Evidence |
|-----------|-------------------------|----------|
| **Bounded KV / working context \(C_t\)** | Main full-attention path; inference state as key–value pairs over a **FIFO chunk queue**; old chunks **evicted** when chunk count or token budget exceeded | §2.1: \(y_t \sim p_\theta(y_t \mid C_t)\); \(C_t\) “composed of key-value pairs”; §3.2 eq. (10) `visible(i,j)` + release of **evicted KV pages** at inference |
| **Prefix-like sink (not full-history prefix)** | **System prompt** kept visible as **attention sink**; all other history subject to turnover | §3.2: “retain the system prompt… attention sink… All other chunks… bounded attention window” |
| **External store / RAG** | **Baseline**, not LiveMem’s intrinsic path; “reconstructive inference” = rebuild \(C_t\) by **reading explicit** past representations (retrieval) | §2.1; §4.1 RAG baseline (Qwen3-Embedding + vector recall); Conclusion: retrieval vs state continuity are **different aspects** |
| **Recurrent memory state \(M_t\)** | **Parallel GDN2 side branch** per layer; \(M_{t+1}=U_\phi(M_t,X_{t+1})\), \(y_t \sim p_{\theta,\phi}(y_t \mid C_t,M_t)\); fixed size, online update over **entire** sequence while \(C_t\) is bounded | §2.2 eqs. (2–3); §3.1 eqs. (4–9); “living memory state” when model decides **after evidence removed from context** |
| **Engineering “notepad” memory** | **Recurrent baseline**: on turnover, summarize into text memory and **feed into the prompt** next round (MemAgent-style) | §4.1 “Recurrent baseline… feeds it into the prompt in the next round” — contrasted with intrinsic \(M_t\) |

**Continuity definition (paper):** *state continuity under context turnover* — computation carried forward through \(M_t\) whose **lifetime is independent of active context**, complementary to external retrieval (Introduction; Conclusion).

### AODL mapping (existing kinds / fields only)

| LiveMem piece | AODL slot | Notes |
|---------------|-----------|--------|
| RAG, notepad Recurrent baseline, summarization patches | **`stateStore`** + **`memory`** node edges | Paper’s “persistent memory storage like **notepads**” and reconstructive access — **explicit, addressable history** supplied to the model on demand (`hotl-0.2`: shared memory is `memory` / `stateStore`, not topology). |
| Chunk FIFO, 32k/8k caps, sink retention, train/serve mask parity | **\(\Gamma_t\)** memory / context **strategy** (policy + declared budgets) | Turnover schedule (§3.2, Appendix C.2 “canonical policy… oldest-first”) is **orchestration policy over what the executor sees**, not a new vertex kind. Declared window caps align with \(\Gamma_t\) token budgets; **observed spend** stays separate (spec: “Declared budget is never evidence of spend”). |
| GDN2 tensors \(S_t^\ell\), KV pages, FlexAttention masks | **Node-local** harness state on **`model` / `executor`** | Private inference continuation (\(M_t\), evicted KV) — same layer as “\(A_\text{identity}\) may be private adapters, policy, **memory**” (`hotl-0.2.md` § identity hypothesis). **Not** serialized into \(\mathcal{O}_t\). |
| LongMemEval answers when evidence **fully evicted** | Validates **harness behavior**, not graph observation | §4.3, Fig. 3–4: accuracy from \(M_t\) when supporting evidence ∉ \(C_t\); does **not** populate \(S_t\) markings or event log. |

**Summary:** LiveMem’s continuity is **dual-path inference** (bounded **KV window** + **intrinsic recurrent store**), with **system-prompt sink** and **context turnover** — **not** “prefix cache entire lifecycle” and **not** replacing **`stateStore`**. External retrieval remains **orthogonal** (“not competing definitions… orthogonal and potentially complementary”, Introduction).

---

## 2. Why memory continuity is **not** observed \(\mathcal{O}_t\) (three-object split)

HOTL: \(\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\) is the **observed graph** at logical time \(t\), emitted from append-only **`eventLog`** + **`observedGraph`**; **intent** and **compiled plan** are separate objects — never substituted (`hotl-0.2.md` § formal object).

LiveMem’s \(M_t\) (and evicted KV) sit **below** that boundary:

1. **Intent** — user/system goals and declared orchestration document. LiveMem does not read HOTL intent; it consumes **token streams** and learned write/read to \(M_t\).
2. **Plan** — immutable compiled graph the runtime may execute. LiveMem’s turnover policy is **serving/training configuration**, not the plan artifact; post-training (SFT/RL on memory QA) is **weight update**, not plan emission.
3. **Observed \(\mathcal{O}_t\)** — typed nodes, edges, **\(S_t\) lifecycle/markings**, router draws \(\Pi_t\), policy/budget fields \(\Gamma_t\), all **receipt-backed** events (`eventId`, `sourceHash`, `causalParents`, snapshot hashes).

**Why \(M_t\) ≠ \(S_t\) or \(\mathcal{O}_t\):**

- Paper: \(M_t\) is **fixed-capacity, lossy**; “We do **not** require that \(M_t\) be able to reconstruct every token exactly” (§2.2). \(\mathcal{O}_t\) requires **replayable, idempotent events** and conflict detection on duplicate keys — not latent compression.
- **Living memory** is defined **behaviorally** (online update, persists after context switch, influences predictions when evidence is **gone from \(C_t\)**) — not by exporting facts into a shared graph (§2.2 “living memory state” (i)–(iii)).
- RAG/notepad path = **reconstructive** (explicit reads into \(C_t\)); LiveMem path = **continuity in model space**. Neither replaces **orchestration observation** of who said what, under which authority, with which evidence gates.

### Receipts still required (orchestration layer unchanged)

Even if an executor runs LiveMem internally, AODL still needs:

| Receipt class | Purpose |
|---------------|---------|
| **Append-only event log** | Canonical record of messages, tool calls, graph mutations, failures |
| **Idempotency / conflict keys** | `(type, candidateId, sourceHash, revision)`; reject duplicate conflicting IDs |
| **Evidence / HITL gates in \(\Gamma_t\)** | Acceptance predicates before commit; LiveMem accuracy ≠ verified compliance |
| **Snapshot + state hash** | Replay checkpoint; independent of neural \(M_t\) |
| **`stateStore` / blackboard writes** | Addressable claims with provenance when history is **external** (paper’s notepad/RAG scale) |
| **Classification on reads** | What may enter the next executor call — not implicit “whatever \(M_t\) remembers” |

LiveMem can make the **model** answer after eviction; it does **not** prove an orchestration fact, authority chain, or merge correctness. **Memory continuity ≠ observed graph.**

---

## 3. Relation to RLM prompt-as-environment

**Mostly unrelated; do not claim interchange.**

| | **RLM** (arXiv:2512.24601) | **LiveMem** (this paper) |
|---|---------------------------|---------------------------|
| Problem | Single huge **prompt string** \(P\); avoid dumping \(P\) into context | **Continual lifecycle** stream; bounded \(C_t\) + intrinsic \(M_t\) |
| Externalization | **REPL environment**; \(P\) as variable; code indexes/slices \(P\); `sub_RLM` | No REPL; no programmatic query API over external text state |
| Memory | Offloaded prompt + truncated stdout metadata | **Learned recurrent state** (GDN2) fused at every layer |
| Closest baseline in LiveMem paper | **Recurrent** text memory re-injected into **prompt** (MemAgent-style) | Explicitly **not** LiveMem’s intrinsic path |

Both address long-horizon inference and contrast with “context = entire history.” RLM is **scaffold + slice discipline** over an **external symbolic object**; LiveMem is **inside-model state transition** under **KV turnover**. AODL may cite both for **rate–distortion** intuition (tokens vs retained dependencies), but RLM’s prompt-as-env is **not** LiveMem’s continuity mechanism and **does not** validate HOTL interchange.

---

## 4. What AODL must **not** import

1. **KV internals as schema** — Head dimensions, GDN2 eqs. (7)–(9), `visible(i,j)`, FlexAttention masks, FP32 tensor shapes (Appendix C.1: \(32\times128\times128\) per layer) belong in **model serving**, not `hotl-0.2` nodes/edges/events.
2. **Collapsing Mem with World** — Do not map \(M_t\) or “living memory” onto **`stateStore`** readings of \(S_t\), **`F_World`**, or **`observed`** snapshots (cf. STP guardrail: `F_Mem` ≠ World; orchestration **observed** ≠ chat/latent context). Intrinsic continuity stays **executor-private**; shared facts stay **`stateStore`** + receipts.
3. **Substituting continuity for \(\mathcal{O}_t\)** — LongMemEval gains when evidence leaves \(C_t\) do **not** replace event log, verifier independence, or fail-closed glue.
4. **New kinds** — No `liveMem`, `kvTurnover`, or GDN2 vertex types; express turnover caps and retrieval strategy under **\(\Gamma_t\)** and **`memory`/`stateStore`** profiles only.
5. **Reminting \(\mathcal{O}_t\)** — Do not redefine the five-tuple to include neural cache; \(S_t\) remains **observed runtime state**, not transformer memory tensors.

---

**Catalog:** LiveMem [2608.02515](https://arxiv.org/abs/2608.02515) — **med** paper; slot **V|S** (executor harness + \(\Gamma_t\) context policy); maps intrinsic **GDN2 \(M_t\)** to node-local mem, RAG/notepad to **`stateStore`**, turnover to **\(\Gamma_t\)**; **KEEP** as continuity research, **SKIP** as observed-graph or schema import; memory continuity ≠ \(\mathcal{O}_t\).
