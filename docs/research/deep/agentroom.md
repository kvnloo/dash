# AgentRoom [2608.23740] × AODL (HOTL 0.2)

Deep read: arXiv **2608.23740v1** (Cho & Lee, *AgentRoom: Concurrent Multi-Agent Coding in a CRDT-Backed Shared Workspace*, 24 Aug 2026). Search: `ddgs text` + `curl https://r.jina.ai/https://arxiv.org/abs/2608.23740` + full PDF extract (`pypdf` on `https://arxiv.org/pdf/2608.23740`). **arXiv id confirmed** — title matches the expected 2026 AgentRoom shared-room paper; no alternate id required.

Shared-state cousins map to **`stateStore` + `observation`**, never inferred **`policies.kinds: swarm`**. **Merge ≠ verify.** No new HOTL 0.3 kinds. Do not remint \(\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\).

---

## 1. What is the “room”? → `stateStore` / `observation`

### Paper definition (not a UI product)

AgentRoom is a **state-management room** for concurrent coding agents: a **structured runtime object** with (i) **file-level claim semantics**, (ii) an **append-only broadcast log**, and (iii) **each agent’s status**, exposed through MCP tools on top of a **CRDT-merged shared filesystem** (§1 System; §2.1).

Architecture (Figure 2): **N coding agents** share workspace \(W\); **pycrdt** (Yrs) merges concurrent writes at **character level** (\(\Delta_{\mathrm{crdt}} = 2\,\mathrm{s}\)) plus a brace/paren sanity check; an **MCP server** exposes:

| MCP tool | Function |
|----------|----------|
| `room_claim(path)` | Atomic file ownership; rejects if another agent holds the path |
| `room_release` | Release claim |
| `room_broadcast` / `room_read` | Append-only **JSONL** message log |
| `room_state` | Peer status |

The paper calls this a **single integrated primitive**: CRDT-mediated \(W\) **plus** a **coordination interface** — co-designed, not sold as a separate “hive UI” (§2.1: “We co-designed the three components below, and we do not ablate them separately”).

**Not** a classic blackboard paper (no blackboard vocabulary), but functionally: **shared mutable artifact** (files in \(W\)) + **coordination metadata** (claims, status, broadcast) + **tool-mediated reads/writes**. **Not** CRDT-as-the-whole-room: claims and broadcast live at the **state-management layer**, enforced by the interface “rather than relying on agent intelligence to parse text claims” (§2.1; contrast §4.6 MCP-chat baseline).

### AODL mapping

| AgentRoom layer | AODL reading |
|-----------------|--------------|
| CRDT-merged filesystem \(W_t\) | **`stateStore`** — declared shared workspace with SEC/character-merge semantics in the adapter profile |
| `room_state`, `room_read`, visible file writes | **`observation`** — classified reads of store + coordination metadata (receipts into \(\mathcal{O}_t\), not new vertex kinds) |
| `room_claim` / `room_release` | **Coordination policy on the store** (lease-like exclusion on paths), not a HOTL `room` kind |
| Advisory six-step workflow (§2.3) | **Prompt/harness profile** on agents; imperfect adherence is reported — not compile-time \(\Pi_t\) |
| Figure 2 multi-agent diagram | **Silhouette only** — see §3 |

CodeCRDT comparison (§1): AgentRoom replaces **implicit** CRDT coordination and **pre-assigned roles** with an **explicit room** and **advisory protocol**, without orchestrated handoffs.

---

## 2. Coordination vs verification — fail-closed reading

### What merge / consensus **does** buy

Substrate: op-based sequence CRDT with **strong eventual consistency (SEC)**. SEC **eliminates data loss under concurrent edits** but is “a property over **byte-level merge**, not **semantic compatibility**”: incompatible signatures at the same offset **both survive** and “break compilation downstream” (§2.2). Figure 3 illustrates **character-level co-existence**, not semantic agreement.

**Parallel-merge** baseline (§2.4): \(N\) agents in **separate** workspaces, **post-hoc file union**, **later-timestamp tie-break** — pure merge heuristics, no MCP room.

### What the paper **does not** equate with correctness

Headline abstract: **“Coordination, not parallelism or CRDT-merge, bears the load.”**

Conclusion (§6): problem framed as **explicit coordination**, not “merge-correct substrate”; **“neither agent count nor the CRDT itself is the main contributor”**; without coordination, naive concurrency **underperforms solo**; **“with the substrate alone, agents converge on bytes but not on intent.”**

Evaluation **quality** (§2.5): LLM-judge composite (plus regex/AST cross-checks). Explicit disclaimer: **“should not be read as software quality at large”**; dimensions omit maintainability, security, long-term cost.

Limitations (§7) — **fail-closed for AODL importers**:

> Quality is assessed by the LLM-judge composite, **not an execution oracle**: tasks do **not** ship a held-out correctness suite (vitest suites are agent-authored) … **do not claim execution-verified correctness**.

Abandonment Tier I uses a **deterministic 1-file classifier**, independent of continuous quality scorers (§2.5).

§4.6 **MCP Chat vs CRDT State**: free-text broadcast claims can miss conflicts; **`room_claim()`** returns a **system-level conflict error** — coordination primitive ≠ proof the merged code is correct.

**AODL verdict:** Treat AgentRoom like CodeCRDT/StateFuse — **`stateStore` convergence + claim rejects** are **observed coordination evidence**. **Verifier independence remains mandatory** (compile witness, tests, human gate, abstaining projection). **Do not** rename CRDT SEC, file-union merge, or LLM-judge ordering as `verify` or as semantic consensus.

---

## 3. Silhouette trap — hive/room drawing vs `policies.kinds`

Figure 2 reads visually like a **multi-agent hive** (A/B/C around a shared core). The paper’s typed object is **runtime state-management** (claims + JSONL broadcast + status + CRDT \(W\)), exposed as **MCP tools**, with an **advisory** collaboration protocol (§2.3: agents “typically deviate”).

Experimental conditions (Figure 1, §2.4, §4.2) are **operational ablations** — Solo, Shared-only (CRDT, no MCP/prompt), parallel-merge, ChatDev-style sequential, partial bundles — **not** topology labels for an IR:

| Condition | What it isolates |
|-----------|------------------|
| Shared-only | CRDT substrate only |
| + collab prompt / no MCP | Prompt without tool surface |
| AgentRoom | Substrate + MCP coordination layer |
| Parallel-merge | Merge without shared coordination |

Discussion (§5): **“The ordering still argues against reading AgentRoom as ‘CRDT plus prompts’ integration”** — largest step attributed to **MCP tool surface**, not merge alone.

**Unlabeled hybrid / swarm:** Any diagram or product name “AgentRoom” without explicit **`policies.kinds`** and edge classification is **⊥** for HOTL compilation — same rule as bMAS/SwarmWorld in the C(RAID) catalog. Explicit **C(RAID) hybrid** must stay **named** in \(\Pi_t\), not inferred from concurrent agents on a shared disk.

Chat-only “room” (§4.6) is a **silhouette trap**: same narrative (agents in a room), **catastrophic** conflict miss vs CRDT-state **`room_claim`** — UI/chat metaphor ≠ typed **`stateStore`** governance.

---

## 4. What AODL must **NOT** import

1. **No new HOTL kind** (`room`, `agentRoom`, `mcp_room`, etc.) — slot stays **`stateStore` + `observation`** with a harness/adapter profile (claims, broadcast log, status schema).
2. **No `policies.kinds: swarm`** (or hive/crew) **from** multi-agent figures, MCP branding, or “collaborative editing protocol” prose.
3. **No CRDT-merge-as-verifier** — SEC, parallel-merge tie-break, and brace balance are **not** semantic proof (§2.2, §7).
4. **No collapsing merge + judge** — LLM-judge/regex/AST composites rank conditions; they **explicitly disclaim** execution-verified correctness (§2.5, §7).
5. **No AgentRoom runtime in Dash `app/`/`bridge/`** — MCP tool surface is an external harness pattern; AODL documents **readings**, not product embedding.
6. **No HOTL 0.3 kinds** — bundle ablation (Appendix B.13) informs **adapter documentation** only; substrate vs coordination split is **qualitative** at small \(n\), not a schema extension.

**KEEP:** Profile text for file-level leases on `stateStore`, append-only broadcast as observation log, peer status reads; **verifier** nodes downstream of merged artifacts.

---

## Evidence anchors (quotable)

- *“AgentRoom is a **state-management room** … **file-level claim semantics**, an **append-only broadcast log**, and each agent’s status** … **MCP tools** (`room_claim`, `room_release`, `room_state`, `room_broadcast`, `room_read`) on top of a **CRDT-merged shared filesystem**.”* (§1)
- *“SEC eliminates data loss … **not semantic compatibility**.”* (§2.2)
- *“**Coordination, not parallelism or CRDT-merge**, bears the load.”* (Abstract)
- *“**do not claim execution-verified correctness**.”* (§7 Limitations)
- *“agents converge on **bytes but not on intent**.”* (§6 Conclusion)

---

**Catalog:** AgentRoom [2608.23740] is a **`stateStore` + `observation`** reading — CRDT workspace plus MCP-enforced claims/broadcast/status — with **merge ≠ verify** and **coordination**, not SEC merge, carrying the empirical load.
