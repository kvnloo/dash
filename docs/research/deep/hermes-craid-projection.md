# Hermes Kanban projection vs CRAID (`craid.json`)

Sources: `examples/valid/craid.json`, `examples/invalid/craid-feedback-cycle.json`, `insights/hermes-dryrun-smallest.txt` (paper gate 1, §8).

Gate 1 is **conservative interchange projection**: validated intent → `compiled-plan` JSON (`cards[]` + `deps[]` only). No Kanban API, spawn, mesh, keel, worker pick, timings, retries, or run order beyond declared deps. AODL is not a second scheduler.

---

## 1. CRAID edges a Hermes Kanban profile **MAY** project

Only edges with `relation: "dependency"` are candidates. Hermes maps each to a **parent → child** Kanban dependency (`#88589` `deps[]` shape). Task/executor (and other runnable) nodes map to deterministic card ids: **`{graphId}:{nodeId}`**.

| Edge id | From → to | MAY project when |
|---------|-----------|------------------|
| `e-product-research` | product → research | **Yes** — gate-1 exemplar; single `sequence` policy, no fanout/reducer |
| `e-research-scoutA` | research → scoutA | Only if compiled **without** sibling fanout and without `policies.fanout` / multi-child semantics |
| `e-research-scoutB` | research → scoutB | Same as scoutA; **not** together with scoutA under gate-1 Kanban profile |
| `e-scoutA-analysis` | scoutA → analysis | Only in isolation; **not** with scoutB→analysis (reducer fan-in) |
| `e-scoutB-analysis` | scoutB → analysis | Same |
| `e-critic-integrate` | critic → integrate | Yes **only** as a linear fragment with `sequence`-only policy and no upstream verification edge in the same compile |
| `e-integrate-deploy` | integrate → deploy | Same linear-fragment rule |

**Practical gate-1 rule:** the profile **MAY** project dependency edges that appear in a **2-node (or strictly linear) slice** whose active policy set is **`["sequence"]` only**. The documented positive proof is exactly one edge: **`e-product-research`**.

`humanGate` (`captain`) may yield **stub card ids + metadata hooks** in broader Hermes work, but that is not required for gate 1; gate 1 does not need to compile the full graph.

There are **no `message` edges** in `craid.json`; message/mesh/auction still abort compile per §8, but they do not appear in this fixture.

---

## 2. CRAID constructs that **MUST** fail-closed (stderr names blocker)

Compilation **MUST** exit non-zero and **not** emit a plan when the intent requires semantics the Kanban profile cannot express conservatively.

### Non-dependency relations (never project as Kanban deps)

| Edge id | Relation | From → to | Fail-closed reason |
|---------|----------|-----------|-------------------|
| `e-analysis-critic` | **verification** | analysis → critic | Verifier gate; not a simple parent/child task dependency |
| `e-integrate-memory` | **data** | integrate → memory | Store/data plane; `memory` has `store` capability, not execute-only Kanban card |
| `e-deploy-captain` | **control** | deploy → captain | Control/human-gate coupling; not interchangeable with `#88589` deps |
| `e-captain-research` | **observation** | captain → research | Feedback/observation (D→R loop leg); must not become a schedulable dep (see invalid cycle fixture) |

### Dependency-shaped but policy-blocked (full `craid.json`)

| Construct | Edges / policy | Fail-closed reason |
|-----------|----------------|-------------------|
| **Fanout** | `e-research-scoutA`, `e-research-scoutB` + `policies.kinds` includes `fanout` | Two children from `research`; Kanban profile does not compile parallel fanout without bounded Hermes semantics |
| **Reducer / fan-in** | `e-scoutA-analysis`, `e-scoutB-analysis` + `fanIn: "reducer"`, `reducer: "analysis"` | Join at `analysis` requires reducer policy Π_t not expressible in gate-1 projection |
| **Human gate / termination** | `captain` (`humanGate`), `constraints.termination.on: "humanGate.approved"` | L0 receipt proof is **gate 2**; full graph termination is out of gate-1 scope |

### Also fail-closed per §8 (not in this CRAID file)

- `message` edges, mesh silhouettes, auction, reducer-without-bounds, any Π_t kind Hermes cannot name.

**Note on `craid-feedback-cycle.json`:** invalid for **graph validation** (feedback via `e-captain-research` as `dependency` closes a cycle). Hermes gate-1 should already fail-closed on **`observation`** for the valid CRAID edge; the invalid fixture is the **negative graph-validation** story, not the gate-1 positive fixture.

---

## 3. Exact `compiled-plan` JSON — 2-node sequence (`product` → `research` only)

Extracted from `graphId: "craid-autonomous-pm"`, edge `e-product-research` only. Policies as gate-1 slice: `["sequence"]`. Artifact only; no runtime fields.

```json
{
  "specVersion": "0.2",
  "graphId": "craid-autonomous-pm",
  "revision": 0,
  "profile": "hermes-kanban-gate1",
  "source": {
    "edgeIds": ["e-product-research"],
    "sourceHash": "89b168f0c83867c1f77da71857c53f79f86f933b85b50ae6ec7ee3a8d0a69839"
  },
  "policies": ["sequence"],
  "cards": [
    {
      "id": "craid-autonomous-pm:product",
      "nodeId": "product",
      "kind": "task"
    },
    {
      "id": "craid-autonomous-pm:research",
      "nodeId": "research",
      "kind": "task"
    }
  ],
  "deps": [
    {
      "id": "e-product-research",
      "parent": "craid-autonomous-pm:product",
      "child": "craid-autonomous-pm:research",
      "relation": "dependency"
    }
  ]
}
```

Hermes Kanban owns execution order among cards subject to `deps[]`; this plan does not add retries, timeouts from `delivery`, or `authority` grants — those stay on the CRAID intent or downstream gates.

---

## 4. Why full `craid.json` is **not** the gate-1 fixture

| Requirement (gate 1) | Full `craid-autonomous-pm` |
|----------------------|----------------------------|
| Smallest slice: 2 tasks, **one** dependency, **`sequence` only** | 10 nodes, 11 edges, policies `sequence`, `retry`, `fanout`, `reducer`, `human_gate` |
| Compile → `plan.json`, exit 0 | Would hit **verification**, **data**, **control**, **observation** edges → **must exit 1** |
| Positive proof: hand fixture match for **min-sequence** intent | Full graph mixes fanout (`research`→scouts), reducer join (`analysis`), and captain feedback (`observation`→`research`) |
| Negative proof: fanout + **message** fixture exits 1 | CRAID negative is **cycle** (`craid-feedback-cycle.json`), a different validator path |
| No orchestration / no second scheduler | Full CRAID encodes PM loop termination, human gate, and memory store — orchestration semantics beyond card id + dep projection |

Gate 1 proves **validate → profile pass → conservative `cards[]`/`deps[]` artifact**. Full CRAID is the **target autonomous-PM blueprint** for later gates (human-gate receipts, fanout/reducer, verification, data, control, observation). Using it as gate-1 would conflate **graph validation**, **unsupported relation projection**, and **policy compilation** in one failing test, obscuring the minimal Hermes interchange contract.

**CLI sketch (documentation only):** `python3 tools/hermes_dryrun.py examples/valid/min-sequence.json > plan.json` — not `craid.json`.
