# Refined MPST (arXiv:2501.18874) → AODL message choreography

**Source:** Amorim et al., *Enforcing MAVLink Safety & Security Properties Via Refined Multiparty Session Types* ([2501.18874v2](https://arxiv.org/abs/2501.18874)), NASA Formal Methods 2025. **Framework:** DATUM (Dynamically Assured Typed Universal Messaging) — RMPST specs in F*, runtime attestation via a MAVLink proxy.

**AODL hook:** A `message` / `delegation` edge is a **session**, not a pipe. Per-frame JSON Schema (MCP tool I/O, A2A JSON-RPC) is the MAVLink **per-message** layer; optional **global type + refinements** live on the **document policy** (open object), not on edges (`additionalProperties: false` on edge records).

---

## 1. Legal message vs legal sequence

| Layer | What is checked | What it guarantees | What it misses |
|--------|-----------------|--------------------|----------------|
| **Legal message** | Each frame matches its local schema: MAVLink XML types / F* `UserType`; MCP `tools/call` input/output; A2A method + part shapes. | Payload fields, enums, and ranges for **this** message id. | Ordering, session state, cross-message invariants, “stale buffer” interactions. |
| **Legal sequence** | The trace conforms to an **RMPST**: MPST skeleton (who sends what label next) **plus** refinements on payloads **and** protocol variables updated along the trace (`curr`, `motors`, `mode`, coupled parameters). | Stealthy attacks that send individually valid frames in an order or context that violates safety. | Nothing about business logic outside the declared global type. |

**Paper’s motivating gap:** Standard MAVLink (and typical agent wire formats) specify **each message separately**, not **safe sequences**. A compromised GCS can send messages that pass per-message validation yet drive the UAV into an unsafe state (*stealthy attack*).

**Canonical sequence bug (Case Study I — mission upload):**

- `MISSION_COUNT N` is a legal message.
- Each `MISSION_ITEM_INT` may be a legal message.
- Yet ArduPilot once accepted **fewer than N** items when a **failed upload from an earlier flight** lingered in a buffer; mid-mission the UAV followed the **old** plan. Every frame can validate; the **sequence + session variable `curr` vs declared `N`** does not.

**DATUM’s fix:** A recursive RMPST with `curr` guarded by `0 ≤ curr ≤ N`, requiring `MISSION_REQUEST_INT` with `x = curr`, then `MISSION_ITEM_INT` with `y = x`, then `curr := curr + 1`, and terminating only with `MISSION_ACK` when `curr = N` or explicit `ERROR`.

**Dynamic check:** Attestation is **per message at the proxy**, but the checker holds **RMPST state** (Offer/Mu/Recur/End, stamped variables in `hidden` monad). A message can be schema-valid yet **rejected** because it is the wrong label, wrong sender/receiver, wrong refinement, or wrong `curr`.

---

## 2. Refinement predicates in English

RMPST extends MPST: each message is `Sender → Receiver : LABEL(payload : Type { refinement })`. Refinements are **boolean predicates** over (a) payload fields, (b) **protocol variables** threaded through `μ`/`Recur` with explicit updates `⟨curr = curr + 1⟩`, and (c) **guarded choice** branches.

Translate the paper’s constructors into audit language:

### Messages

- **Mission count:** “The GCS may send `MISSION_COUNT` only if `N` is at least 1 and below the platform mission-item limit.”
- **Mission request:** “The UAV may send `MISSION_REQUEST_INT` with index `x` only if `x = curr` and `curr < N`.”
- **Mission item:** “The GCS may send `MISSION_ITEM_INT` with `y` only if `y` equals the index `x` the UAV just requested.”
- **Mission ack:** “The UAV may send `MISSION_ACK` with result `t` only if `t` is `ERROR` **or** the upload completed (`curr = N`).”

### Recursion / session memory

- “While `0 ≤ curr ≤ N`, repeat the request/item exchange; after each accepted item, set `curr` to `curr + 1`.”
- “Start the sub-protocol with `curr = 0` after `MISSION_COUNT N`.”

### Guarded choice

- “After each item step, the UAV either requests the next index (`curr < N`) or closes with `MISSION_ACK` (error or `curr = N`).”

### Cross-parameter safety (Case Study II — overly permissive ranges)

- “A `PARAM_SET` on `MC_PITCHRATE_MAX` with value `n` is allowed only if `n` is below a bound computed from the **current** values of `MC_PITCH_P` and `MC_PITCHRATE_FF` (weighted product).”  
  *English:* feed-forward and P-gain cannot jointly be high unless max pitch rate is capped accordingly.

### Temporal / state preconditions (Case Study III — parachute)

- “`MAV_CMD_DO_PARACHUTE` with `n = 2` is allowed only if motors are armed, mode is neither ACRO nor FLIP, vertical velocity indicates descent (`v_z < 0`), and altitude is at or below the configured chute minimum.”  
  *English:* do not deploy the chute while climbing, in acro/flip, or above the documented altitude floor—even though the bare command enum allows the frame.

### MPST-only vs RMPST

- **MPST alone:** “B must receive `MSG` after A sends `MSG`.”
- **RMPST adds:** “…and the integer in this `MSG` must equal the integer A sent two steps ago,” or “…and `curr` must match the sequential index,” or “…and coupled parameters must satisfy a derived inequality.”

**Implementation note (DATUM):** Refinements use `RefType` + predicates evaluated at attestation time—not full dynamic typing of arbitrary F*—so runtime cost is **predicate evaluation**, not re-typechecking F*.

---

## 3. Optional global type on AODL policies (open object), not on edges

**Constraint:** Edge records in AODL are **closed** (`additionalProperties: false`). You cannot hang `globalType`, `scribble`, or `refinements` on a `message` edge without a schema change.

**Pattern:** Declare choreography **once per document** (or per named session class) under `policies`, which is intentionally an **open object** (extensions allowed). Edges only name **who talks to whom** and stable edge kinds; the **session contract** is optional metadata at policy scope.

**Suggested shape (illustrative JSON):**

```json
{
  "policies": {
    "kinds": ["craid", "fail-closed"],
    "choreo": {
      "profile": "scribble",
      "globalType": "global GCS(UAV) { ... }",
      "refinements": [
        {
          "id": "mission-upload",
          "english": "MISSION_COUNT N then exactly N sequential MISSION_ITEM_INT with curr tracking",
          "datumRef": "optional-uri-to-fstar-or-generated-attestor"
        }
      ],
      "participants": {
        "orchestrator": "node:gcs",
        "worker": "node:uav"
      }
    }
  },
  "edges": [
    {
      "kind": "message",
      "from": "node:gcs",
      "to": "node:uav",
      "channel": "mavlink"
    }
  ]
}
```

**Rules:**

1. **`policies.choreo` is optional.** Missing `choreo` means “message edges are specified; sequence safety is **unspecified**, not inferred” (same stance as AODL catalog: optional session-type profile).
2. **Do not duplicate global type on each edge** — projection is computed from `policies.choreo.globalType` + node ids referenced by edges.
3. **Refinements list** carries human-auditable English (and optional machine refs to DATUM/F*/Scribble artifacts) without widening edge schemas.
4. **Fail closed:** If `choreo` is present and a trace violates projection or refinement, compilation/attestation yields **⊥** (duality / ordering failure), not silent downgrade.
5. **Open object at `policies`:** New keys (`choreo`, `datum`, `sessionProfile`) are policy-level extensions; validators use `additionalProperties: true` (or explicit `patternProperties`) on `policies`, while `edges[]` items stay closed.

This mirrors 2501.18874: one MAVLink RMPST corpus (~8.5k lines generated F*) sits **beside** hundreds of per-message types—not inside each message definition.

---

## 4. MCP / A2A trace: legal per message, unsafe as sequence

**Setting:** User-facing agent (A2A **client**) ↔ **orchestrator** (A2A **server**) ↔ **tool host** (MCP **server**). Every JSON-RPC frame below validates against MCP 2026-07-28 and A2A task/message schemas **in isolation**.

| Step | Wire | Per-message legality | RMPST / refinement violation |
|------|------|----------------------|------------------------------|
| 1 | A2A `SendMessage` / `message/send` — user delegates “summarize repo `README` only, read-only.” | Valid task, valid parts, valid context id. | — (session start) |
| 2 | MCP `tools/list` | Valid request/response. | — |
| 3 | MCP `tools/call` `read_file` `{ "path": "README.md" }` | Tool exists; args match input schema. | — |
| 4 | A2A `message/send` — user “cancel task” or new message that **closes** the read-only delegation (valid cancellation part). | Valid A2A envelope. | Global type still expects **either** tool results for open client ops **or** explicit task terminal state before new capability use. |
| 5 | MCP `tools/call` `write_file` or `bash` (destructive) with schema-valid args | MCP layer accepts tool name + JSON args. | **Unsafe sequence:** destructive tool after cancellation / without an in-flight `input-required` handshake; violates refinement “write tools only while `delegation.capability = read-only` and `task.state ∈ {working, input-required}`.” |
| 6 | (Optional) A2A `tasks/get` shows `completed` while step 5 was in flight | Each poll is legal. | **Interleaving:** completion claimed before tool side-effects bounded—classic MPST **duality** gap if send/receive not paired. |

**Stealthy reading (parallel to compromised GCS):** A malicious or buggy orchestrator can pass MCP schema validation on every call yet **reorder** cancel vs tool execution like the mission-buffer bug: each `tools/call` is a “legal MAVLink frame,” but the **session variable** (delegation scope, task state, capability token) does not match the refinement.

**What an AODL `policies.choreo` would say in English:**

- “After `read-only` delegation, only `tools/call` on tools tagged `read` until `TaskState` is `completed` or `canceled`.”
- “On `canceled`, no further `tools/call` except `tools/list`.”
- “`write_file` / `bash` require `delegation.capability = read-write` established in an earlier **paired** A2A message, not inferred from tool schema.”

**Attestation placement:** Same as DATUM’s proxy—check at the **message edge adapter** (MCP/A2A bridge) with state carried in the attester, types declared in **`policies.choreo`**, not stuffed into individual edge JSON.

---

## References

- [2501.18874v2](https://arxiv.org/abs/2501.18874) — RMPST + DATUM + three MAVLink case studies.
- AODL catalog note: optional session-type / global type on `message` skeleton; disagreement → ⊥ (`/workspace/docs/research/aodl-craid-20260911.md` backlog item 6).
- Continuous insights: rMPST confirms global protocol excludes unsafe **sequences**, not just illegal messages (`/workspace/docs/research/continuous-insights-20260911.md`).
