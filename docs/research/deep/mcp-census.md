# MCP ecosystem census (Guo et al., arXiv:2509.25292) → AODL adapter reading

**Paper:** *A Measurement Study of Model Context Protocol Ecosystem* — [arXiv:2509.25292](https://arxiv.org/abs/2509.25292) (v3, Nov 2025).  
**Instrument:** MCPCrawler — six markets, 14-day crawl, public dataset ([mcp_collection](https://github.com/zhuaiballl/mcp_collection)).  
**AODL wire:** hotl-0.2 — MCP remains an **adapter** on `tool` / `service` ports; not a fourth object; do not promote census fields into HOTL or remint observed \(\mathcal{O}_t\).

---

## 1. What they measured — and what belongs on ports vs \(\Gamma_t\)

### What MCPCrawler actually measured

| Dimension | Objects & signals (paper) | Evidence |
|-----------|---------------------------|----------|
| **Markets / listings** | Six markets (e.g. MCP.so, MCP Market, PulseMCP, Smithery, MCP Servers, cursor.directory); 17,630 raw entries → **8,401** valid projects (**8,060 servers**, **341 clients**); noise filter ~50% invalid (placeholders, inactive forks, no executable code). | Abstract; §5.1–5.2; Table 4 narrative |
| **Cross-market identity** | Entity dedup via GitHub URL, TF–IDF name/description similarity, author/license, commit activity; **32.3%** in >1 market, **5.5%** in ≥4 markets. | §5.3 |
| **Servers — supply chain** | Declared **library dependencies** per language (top-20 bars); monocultures (Spring on Java, pydantic/zod on Py/TS vs weaker validation patterns on Go/Rust). | §6.1 |
| **Servers — maintenance** | Repo size, LOC, commits; **40.9%** updated ≤90d, **21.9%** inactive >1y. | §6.2 |
| **Servers — exposure class** | Functional **category** from docs/metadata (productivity, DB, auth, cloud, browser, …); **11.2%** “sensitive APIs”; **43%** of that group auth-related; language mix **93%+** JS/Python. | §6.3 |
| **Clients — transport** | Declared protocols: **SSE 56.9%**, **stdio 38.1%**, other **4.9%**. | §7.1 |
| **Clients — topology** | **80.9%** single-server connection, **19.1%** multi-server. | §7.2 |
| **Clients — interaction profile** | “Connection fingerprint”: communication modes (SSE, stdio, HTTP streaming, hybrid), **handshake sequences**, **authentication requirements**, session persistence; composite quality from stars, Glama security/license ratings, Pulse usage. | §4.2.3 |
| **Market metadata schema** | Crawler **normalizes marketplace records** to JSON (mandatory: name, owner, description, URL; optional: ratings, tags, license) — **not** a census of every live `tools/list` JSON Schema. | §4.2.1 |
| **Protocol versions (MCP proper)** | Background only: init exchanges **protocol versions and capability sets**; discovery via `tools/list` / `resources/list`; paper does **not** report a distribution of MCP spec revision strings across live handshakes at scale. | §2.1 workflow |
| **Auth** | Measured as **client connection fingerprints** (auth requirements on sessions) and **server category** (auth-related sensitive connectors), plus risks of token leakage on stdio/SSE — not per-tool OAuth scope matrices. | §4.2.3, §6.3 |

**Not in scope for this paper (important for AODL):** systematic live probing of every server’s `tools/list` output, JSON Schema validity rates, or tool-name collision rates across aggregated registries. Limitations state reliance on **repository metadata and declared dependencies**, not full runtime behavior (§8).

### AODL placement: tool/service **ports** vs \(\Gamma_t\) **allowlists**

| Measured fact (ecosystem) | Belongs on MCP **adapter / port wiring** (compile + bind) | Belongs on **\(\Gamma_t\)** (intent policy, fail-closed) |
|---------------------------|------------------------------------------------------------|----------------------------------------------------------|
| Transport & session shape (SSE vs stdio, multi-server host) | **Adapter profile:** how the port is reached (stdio pipe vs streamable HTTP/SSE), session stickiness, TLS — affects compilation of `service` endpoints and attester placement. | **Allow which transports** and **how many concurrent MCP attachments** per agent/host (19.1% of clients already multi-server — policy must cap blast radius). |
| Per-tool JSON Schema from `tools/list` / `tools/call` | **Port surface:** tool id, input/output schema, effect class bound to `tool`/`service` port multiset; adapter validates frames at the wire (per-message legality). | **Which tool ids / server origins** each agent may invoke; **sensitive capability classes** (auth, cloud, browser, external data — paper’s §6.3 taxonomy as *policy labels*, not HOTL kinds). |
| Marketplace listing quality (~50% junk) | **Compiler warning / reading only** — “catalog abundance ≠ authorized port.” Does not auto-expand \(P(v)\). | **Explicit allowlist** of MCP server identities (URL, package digest, market id) authorized for this program; deny attach-by-discovery. |
| Dependency monoculture & stale repos | **Supply-chain attestation** on the adapter binary/package chosen to implement a port (SBOM, pin, maintenance SLA). | **\(\Gamma_t\)** pins approved server **implementations** and patch windows; fail closed if recovered/deployed artifact ∉ allowlist. |
| Host “unified tool registry” (MCP background) | **Adapter merges** listings at runtime — risk of **homonymous tools** across servers unless port ids are qualified. | **\(\Gamma_t\)** requires **qualified names** (server + tool) and denies ambiguous short names; maps to AgentFlow-style “extra capability edge” checks. |
| Client auth requirements (fingerprint) | Adapter enforces **credential binding** at connect (headers, env, OAuth) per port contract. | **\(\Gamma_t\)** declares **least privilege**: which secrets, scopes, and auth-capable servers are in scope for which role. |

**Rule:** Census statistics inform **readings** and **adapter discipline**; only **declared** port multiset + **\(\Gamma_t\)** entitlements compile. Marketplace scale is not permission.

---

## 2. Failure modes → fail-closed compile vs runtime adapter errors

Paper-native risks and the AODL split (compile rejects intent/plan mismatch; runtime adapter returns structured errors on the wire without widening HOTL).

| Failure mode | What the census shows | **Fail-closed compile** (\(\bot\) before run) | **Runtime adapter error** (session alive, call rejected) |
|--------------|----------------------|-----------------------------------------------|----------------------------------------------------------|
| **Broken / weak schemas** | Uneven validation culture: many Py/TS servers depend on **pydantic/zod**; Go/Rust stacks often lack equivalent guards (§6.1). Study does not count invalid `tools/list` schemas — limitation: metadata-only (§8). | Intent declares tool port with **required JSON Schema**; compiler/\(\pi_v\) **triple mismatch** if declared port schema ≠ adapter manifest; missing schema on a declared sensitive class → \(\bot\). | `tools/call` args fail schema validation; adapter surfaces MCP error, no silent coerce; does not add tools to registry. |
| **Over-privilege** | **11.2%** servers in sensitive categories; auth connectors **43%** of that slice; misconfiguration/compromise amplified (§6.3). Related ecosystem work (cited in paper’s plugin line) flags **high-risk API usage** in real MCP plugins. Host aggregates all discovered tools into one registry (§2.1). | **\(\Gamma_t\)** lacks allowlist entry for agent→`service` binding; sensitive category invoked without `humanGate` / capability mode in intent; multi-server attach beyond declared fanout → \(\bot\). | Server exposes tools outside compiled allowlist; adapter blocks `tools/call` after `tools/list` diff; auth/token scope insufficient at handshake. |
| **Name / identity collisions** | Cross-market **duplicate listings** and **similar names** resolved by multi-feature matching (§4.2.2, §5.3) — ecosystem redundancy, not a single global namespace. Multi-server clients (**19.1%**) plus unified registry → ambiguous `tool` names unless qualified. | Unqualified tool id on port graph when program attaches **>1** MCP server; ambiguous `service` endpoint identity; intent server id collides with two marketplace entries → \(\bot\) until disambiguated in \(\Gamma_t\). | Wrong-server routing at resolver; `tools/call` hits homonym on non-authorized server; connection fingerprint mismatch (hybrid SSE+stdio) flagged in adapter telemetry. |
| **Stale / fake “servers”** | **>50%** listings invalid; **21.9%** servers inactive >1y (§5.2, §6.2). | Pin to **known artifact** in plan; refuse compile if only marketplace metadata, no approved implementation digest. | Connect/timeouts, empty `tools/list`, placeholder repo behavior — adapter error, no graph mutation. |
| **Supply-chain cascade** | Spring/npm/PyPI monocultures (§6.1, §6.3). | Disallowed dependency profile in attested adapter bundle → \(\bot\). | Exploit at runtime — containment via port allowlist + observation receipts, not IR extension. |

**Choreography note (orthogonal to census but same adapter):** Per-frame MCP legality does not imply safe **sequences** (rMPST reading in-repo). Census does not measure ordering bugs; optional `policies.choreo` stays a compiler profile, not HOTL 0.3.

---

## 3. Adapters row for MCP (one line of truth, no schema change)

Keep the existing Adapters table shape (`MCP` | job column). **Replace or extend only the job cell copy** with a single sentence that absorbs the census without new HOTL fields:

> **MCP — Tools on `tool`/`service` ports (not \(\mathcal{O}_t\)); treat marketplace discovery as untrusted—Guo et al. (2509.25292) find ~half of indexed MCP projects invalid and widespread sensitive/auth connectors, so compiled port multisets plus \(\Gamma_t\) allowlists must pin qualified servers/tools while the adapter validates wire schemas and sessions (SSE/stdio).**

No change to `hotl-0.2` schema, edge records, or kinds.

---

## 4. What AODL must **not** import

| Do **not** import | Why (paper-aligned) |
|-------------------|---------------------|
| **MCP as IR** (hosts, clients, marketplaces as HOTL node kinds) | Paper’s objects are **deployment ecosystem** entities; AODL already has `tool`/`service` ports and adapters. |
| **Marketplace census fields** (Glama stars, 8,060 count, validity %, overlap heatmaps) into \(\mathcal{O}_t\) or intent schema | Aggregate **readings** only; observation stays run receipts, not crawler snapshots. |
| **Per-market JSON normalization schema** as HOTL `additionalProperties` on edges | Crawler unified listing schema (name, owner, URL, …) is **MCPCrawler’s** artifact, not orchestration semantics. |
| **Client protocol pie charts** (SSE 56.9%, etc.) as enum kinds | Transport belongs in **adapter profile**, not new `policies.kinds`. |
| **Server functional taxonomy bars** as mandatory HOTL labels | Use as **\(\Gamma_t\) vocabulary** / compiler hints for sensitive-class policy, not closed-world node types. |
| **“Unified tool registry”** as a graph store | Registry is **host runtime** behavior (§2.1); AODL declares authorized bindings, not LLM-side discovery merges. |
| **Reminting \(\mathcal{O}_t\)** from mcp_collection dumps | Dataset supports reproducibility for **research**; observed orchestration graphs remain harness/OTel-shaped. |
| **HOTL 0.3** kinds (`mcpServer`, `market`, `plugin`, …) | Forbidden by program; adapter census is catalog prose + readings. |

---

## References

- Guo, Hao, Zhang, Xu, Lv, Chen, Cheng — *A Measurement Study of Model Context Protocol Ecosystem*, arXiv:2509.25292v3, 2025.
- MCPCrawler: [github.com/zhuaiballl/mcpc](https://github.com/zhuaiballl/mcpc); dataset: [github.com/zhuaiballl/mcp_collection](https://github.com/zhuaiballl/mcp_collection).

**Catalog sentence:** MCP maps tools to `tool`/`service` ports, not \(\mathcal{O}_t\); the 2509.25292 census is a warning that marketplace discovery is mostly noise and sensitive connectors—compile qualified ports under \(\Gamma_t\), let the adapter enforce wire schemas and sessions.
