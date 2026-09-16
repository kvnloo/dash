# Deep read: Pact (arXiv [2605.03143](https://arxiv.org/abs/2605.03143))

**Source:** Gopinathan, Feser, Naim, Tavares, Bingham — *Pact: A Choreographic Language for Agentic Ecosystems* (Choreographic Programming Workshop, 2026). Full text via arXiv HTML (`2605.03143v1`); Jina reader blocked (Cloudflare). Joined to AODL C(RAID) notes in-repo.

**Thesis (paper):** Classical choreographies are **deadlock-free** and **correct-by-construction** for *communication structure*, but assume **cooperative** participants. They do not explain **why** a self-interested agent follows a protocol. Pact extends choreography with **choices**, **utilities**, and **nature** so every protocol maps **unambiguously** to a **formal game**; analysis (e.g. theory-of-mind decision policies) sits **on top** of programs, not inside the runtime choreography kernel.

---

## 1. Global type ↔ local projection ↔ AODL `message` / `delegation`

| Layer | Pact / MPST | AODL |
|--------|-------------|------|
| **Global** | One choreographic program over named roles (buyer, seller, `world`). Describes the **session** — who sends what, when, under which branches (`broadcast`, `if`). | Declared graph \(\mathcal{O}^{\mathrm{intent}}\): edges typed **`message`** / **`delegation`** are **sessions**, not byte pipes. Global skeleton = who may talk to whom along which control path. |
| **Local** | **Endpoint projection** compiles each role to a local program (`bookseller_buyer`, `bookseller_seller`): `send`/`recv` alternate with the dual party. | Per-node **compiled plan** + harness: each participant sees only its projection of the declared session graph. |
| **Check** | Deadlock freedom: every global `send` has a matching `recv` on the counterpart after projection (choreographic guarantee). | **Fail closed:** if projection cannot dualize sends/receives (orphan endpoint, fanout violating session discipline, mesh where C(RAID) forbids it), **compilation is ⊥** — do not run. |

**Alignment:** AODL does not replace Pact’s choreographic semantics; it **names the same split** at IR level: declare the **global** interaction shape in the document; **project** to locals for Dash/bridge/Hermes profiles; **validate** before spawn. `message`/`delegation` are the edge kinds that should eventually be checkable like a global type (MPST, HasChor, NuScr-style adapters per catalog — **KEEP adapters**, not a second scheduler).

**Distinction:** Pact’s global program is **executable choreography text**; AODL’s graph is **\(\mathcal{O}_t = (V_t, E_t, S_t, \Pi_t, \Gamma_t)\)** with three objects (intent ≠ compiled plan ≠ observed). Pact informs **\(\Gamma_t\)** (protocol/session layer) and **reasoning about \(\Pi_t\)**, not substitution of intent with recovered code graphs.

---

## 2. Choices, utilities, nature → game = auction \(\Pi_t\)

Pact adds three constructs on top of the bookseller choreography:

1. **`agent.choose(τ)`** — strategic decisions made **explicit**; dynamically **nondeterministic** in the language, **resolved** by game-theoretic analysis (not hardcoded `price_of` / `price < budget` in the trusted core).
2. **`agent.values(…)`** — declares **factors** in utility (e.g. `buyer.values(book.quality)`); **not** honest revelation of full utility (strategic agents won’t report truth). Basis for **negotiation** and counter-proposals.
3. **`world.choose(…)`** — exogenous **nature** (e.g. `book.quality <- world.choose(float)`); agents inject **priors** when analysing expected payoff.

**Paper claim:** After these extensions, the bookseller protocol corresponds to a **complete formal game**; the choreographic bookseller “recreates” a **market for lemons**-style phenomenon; literature comparison notes **auction-style** game DSLs as a **narrow** class vs Pact’s **communication + game** union.

**AODL mapping:** **\(\Pi_t\)** is **allocation / routing policy** — marketplace, auction, contract-net, router — **not a product SKU**. The Pact reading is:

\[
\Pi_t \;\equiv\; \text{policy over strategic choices under declared utilities and nature priors.}
\]

Auction semantics in AODL describe **who gets the task / turn / resource** and **under what declared preferences**, analogous to `seller.choose(price)` and `buyer.choose(bool)` **before** any settlement. **AdaptOrch**-style topology selection is another \(\Pi_t\) reading; Pact supplies the **game-theoretic “why follow?”** layer on top of the same graph.

**Do not conflate:** Pact’s **solver** (Section 3: theory-of-mind, bounded-rational decision policies) is **analysis tooling** on projected games — not the HOTL runtime. AODL keeps \(\Pi_t\) as **declared policy metadata** compileable to profiles, not an embedded Nash solver in `validate.py`.

---

## 3. Deadlock-free projection = fail-closed duality

**Pact (classical choreo):** Guarantees **deadlock-freedom by construction**: endpoint projection yields local processes where **every send is matched** by a corresponding receive on another party. Branching uses **`broadcast`** so all roles agree on the same choice visibility before `exchange`.

**Dual reading for AODL:** Session typing’s **duality** (offer ↔ select, send ↔ recv) is the same invariant as “no orphan messages.” AODL’s operational slogan **fail closed** is the **compiler/runtime mirror**:

- If dualization fails → **⊥** (exit non-zero, no Kanban write, no spawn).
- Gate 1 interchange already **stops** on illegal `message`/mesh/auction combinations (e.g. C(RAID) fanout+message must **exit 1**).

So: **deadlock-free projection** (Pact) = **successful endpoint projection**; **fail-closed** (AODL) = **reject the document** when the global session cannot project to consistent locals. Cooperative choreography assumes participants **execute** the projected locals; AODL assumes agents may **deviate** strategically — hence \(\Pi_t\) as game — but still **refuses** structurally inconsistent protocols.

---

## 4. What AODL must **NOT** import from Pact

| Import | Why forbidden / out of scope |
|--------|------------------------------|
| **`exchange(…, price)` / balance / payment execution** | Pact’s bookseller **settles** with money transfer (`balance += recv(buyer)` on seller). AODL auction \(\Pi_t\) names **allocation** and incentives; **payment execution** is a **harness / external settlement** concern, not graph IR. Catalog line: **payment execution forbidden** for AODL-as-language. |
| **Cooperative participant model** | Plain choreography assumes agents **follow** the protocol. AODL + Pact **game** reading is for **analysis** and declared \(\Pi_t\), not assuming compliance. |
| **Honest utility reporting** | `values` is negotiation surface, not attested payoff functions. Do not store “true utilities” as authoritative \(\mathcal{O}_t\) fields. |
| **Pact decision-policy solver as runtime** | Theory-of-mind / bounded-rational solver is **offline analysis** on projected games — not a replacement for bridge spawn, Hermes, or Dash turn store. |
| **Pact as observed \(\mathcal{O}_t\)** | Same three-object rule: recovered or negotiated Pact text ≠ observed run; intent ≠ plan ≠ trace. |

**Keep (adapter):** Global type checking for `message`/`delegation` skeletons; game-theoretic **interpretation** of \(\Pi_t\) when policy is auction/marketplace; conservative interchange that **projects** 2-node `sequence` to compiled JSON and **stops** before forbidden layers.

---

## One-line catalog

*Pact is why a self-interested agent might follow the session AODL already declares; \(\Pi_t\) is the auction-shaped game reading; payment stays outside the document.*
