# C(RAID) captain loop × human attention budget

Working note tying `craid.json`, HOTL 0.2 `constraints.budgets`, and [arXiv:2606.08919](https://arxiv.org/abs/2606.08919) (*Oversight Has a Capacity*). No schema change: `budgets` is already an unconstrained object; enforcement belongs in a **compiler profile**, not new node kinds.

---

## 1. Captain observation loop as a flooding surface

The valid CRAID fixture `craid-autonomous-pm` is a closed **Continuous** loop, not a one-shot DAG:

| Edge | Relation | Role |
|------|----------|------|
| `e-integrate-deploy` | `dependency` | Integration hands work to deployment (I → D). |
| `e-deploy-captain` | **`control`** | D-phase surfaces state to the captain (`humanGate`). |
| `e-captain-research` | **`observation`** | Captain feeds back into `research`, restarting R-phase. |

Upstream parallelism amplifies load before the loop closes:

- `research` fans to `scoutA` / `scoutB` (`policies.fanout` + `reducer: analysis`).
- `analysis` → `critic` is a **`verification`** edge (critique can become an escalation path under profile policy).

**Flooding surface (informal):** any runtime that treats `observation` as “refresh the frontier” without a shared escalation ledger can **re-enqueue human work faster than a fatiguing reviewer can clear it**. Each D-phase `control` arrival at `captain` is a natural **escalation draw**; each approved observation that re-arms `research` can produce **new** deploy/critic outcomes that again hit `captain`. That is structurally the same failure mode Turan et al. model as a **reviewer-fatigue / flooding attack**: escalation rate is not monotonically safe—realized safety can follow an **inverted-U** in escalation load, and an adversary (or merely over-eager “escalate everything” policy) can slip high-impact actions past a saturated gate.

The graph already encodes the risky topology; it does **not** encode the capacity limit. That gap is intentional in 0.2: declare the cap in \(\Gamma_t\) (`constraints.budgets`), spend it in the plan profile (which edges count as draws, what “pending” means), fail closed when the ledger would go negative.

**Policy invariant (not a new field):** critique/verifier routes must not mint a second, invisible queue to the captain. They draw from the same `humanAttention` ledger as `control` → `humanGate`, or compilation/runtime is \(\bot\).

---

## 2. Schema-legal `budgets.humanAttention` example

HOTL 0.2 requires `constraints.budgets` as an object with **no fixed property enum**—same pattern as `tokens` and documented examples like `children`. A numeric cap is therefore already valid JSON Schema.

Minimal extension of the CRAID fixture’s constraints block:

```json
"constraints": {
  "budgets": {
    "tokens": 0,
    "humanAttention": 3
  },
  "termination": {
    "on": "humanGate.approved"
  }
}
```

Optional attribution on the D-phase wire (opaque object on the edge; schema-legal in 0.2):

```json
{
  "id": "e-deploy-captain",
  "relation": "control",
  "from": "deploy",
  "to": "captain",
  "fromPort": "out",
  "toPort": "in",
  "budget": { "draw": "humanAttention" },
  "delivery": { "order": "ordered", "idempotent": true, "timeoutMs": 60000, "maxRetries": 0 },
  "authority": { "grant": ["execute"], "delegationDepth": 0 }
}
```

Naming `humanAttention` is **convention + validator profile**; the schema accepts the key today.

**Semantics (aligned with 2606.08919):** cap **pending** `humanGate` escalations per policy-defined window (e.g. per graph revision, per rolling interval, or per CRAID cycle). The number is not “total approvals ever”—it is **concurrent load on the reviewer**. Exceeding the cap is not a soft warning.

---

## 3. D-phase, `humanGate.approved`, and the cap

**D-phase in this graph** is the `deploy` task plus the `control` edge into `captain`. That is the only explicit human surface in the fixture; R/A/I stages run under `execute` grants until deploy tries to move the loop forward.

**Termination** is declared separately from budgets:

```json
"termination": { "on": "humanGate.approved" }
```

Interpretation:

| Mechanism | Effect on the loop | Effect on the budget |
|-----------|-------------------|----------------------|
| `humanGate.approved` | **Stop condition** for the continuous CRAID run: the captain’s affirmative approval ends the current trajectory (success path for “we ship / we accept this cycle”). | Resolves **one** pending escalation tied to that approval event; does not by itself raise the cap. |
| Pending at `captain` | Blocks or buffers D-phase handoff until a human acts. | Each pending slot counts toward `humanAttention` until resolved (approve, reject, or profile-defined timeout → fail closed). |
| `e-captain-research` (`observation`) | After human action, may **re-open** R-phase; the loop continues until `termination.on` fires. | New cycles can generate **new** deploy/critic escalations; the ledger must be updated per profile rules (e.g. reset window on approval vs accumulate across cycles). |

So **`humanGate.approved` and the cap are orthogonal controls**:

- **Approved** answers “may this graph run terminate cleanly?”
- **humanAttention** answers “may we **admit another** escalation while others are still pending?”

A profile should not treat “captain eventually approves” as permission to queue unbounded work in flight: termination is the **happy exit**, the budget is the **safety guard** while the loop is live. That matches the paper’s resource-allocation framing: the guard spends finite attention; full escalation is not optimal and is attackable.

`policies.kinds` already includes `human_gate`; no new kind is required for D-phase gating.

---

## 4. Fail-closed when pending escalations exceed the cap

**Where the rule lives:** compiler profile (plan sheaf \(\mathcal{F}_{\mathrm{plan}}\)), not HOTL 0.2 schema and not new `intentGraph.nodes[].kind` values.

**Static checks (compile time), typical profile rules:**

1. Read `constraints.budgets.humanAttention` (if absent, profile may default to \(\bot\) for CRAID `protocol: "craid"` or apply a conservative default—fixture should declare explicitly).
2. Enumerate edges that **draw** `humanAttention` (`control` → `humanGate`, and any `verification` → `humanGate` routes the profile maps).
3. Bound **parallel pending** escalations: e.g. fanout width × verification branches that can reach `captain` without reducer gating must not imply a steady-state pending count above the cap without an intermediate auto-resolve (forbidden for CRAID D).
4. If the graph structure or declared policies imply `pending_max > humanAttention`, **compilation fails** (\(\bot\)).

**Dynamic checks (runtime), same profile:**

- On each escalation enqueue, `pending + 1 > humanAttention` → **fail closed**: do not deliver to the human inbox, do not auto-approve, do not spawn a shadow queue. Hold or abort per `human_gate` policy kind already in `policies.kinds`.
- Observation-driven re-entry (`captain` → `research`) while at cap: **do not** silently drop the cap; either block the observation until pending drops, or abort the run—never “flood the captain” as a fallback.

**What we do not add:** no `floodingLimiter` node kind, no schema enum patch for `budgets`, no second human gate type. The existing `humanGate` + `human_gate` policy + `constraints.budgets.humanAttention` + profile arithmetic is the whole mechanism.

---

## References

- Fixture: `/tmp/research/aodl/examples/valid/craid.json`
- Insight capture: `/tmp/research/insights/attention-budget.txt`
- Oversight capacity / inverted-U / flooding: [arXiv:2606.08919](https://arxiv.org/abs/2606.08919)
- C(RAID) R-phase context: `docs/research/aodl-craid-20260911.md` (Dash mirror)
