# Needs Kevin

On the Approvals screen a Needs Kevin card lists items that supervised workers need the owner to decide, with a Refresh Needs Kevin button. When the supervision host is not available the card says so plainly instead of showing an empty list.

Status: UNCOVERED (no committed army test drives it)
Draft spec (uncommitted, does not count): `e2e/mbp-army/rc3-09-10-orchestra-bots-approvals-and-trace-sc.spec.ts` › "Needs Kevin reports an unavailable supervision host honestly"

## Sub-features

- `needs-kevin-unavailable` the card shows "Supervision unavailable (HTTP 503)" and keeps it after Refresh [UNCOVERED].
- `needs-kevin-list` a supervision batch lists the owner items with why, recommendation and evidence, and Refresh Needs Kevin reloads [UNCOVERED].

## How to get to it (user POV)

- Open Approvals (header "Upstream approvals" button or Settings, Review approvals); the Needs Kevin section is on that screen.

## Driving it with the tester army

Preconditions:

- The stack is up and `army-stack.sh doctor <run>` passes.
- Default fixture bridge: no supervision directory, so `/supervision` answers 503. For the list case a fixture batch directory must be passed to the bridge via `DASH_SUPERVISION_DIR`.

- **Open Approvals.** `await pair(page,bridge)`, click `getByRole('button',{name:/^(Upstream approvals|Approvals), 1 pending$/}).first()`.
- **Unavailable.** `const nk=page.getByTestId('needs-kevin')`. `nk.getByRole('alert')` contains `Supervision unavailable (HTTP 503)`. Click `nk.getByRole('button',{name:'Refresh Needs Kevin',exact:true})`: the same alert remains.
- **Run.** No committed spec. Add the journey above as a test in `e2e/mbp-army/army.spec.ts` (or a new `e2e/mbp-army/needs-kevin.spec.ts`), then `army-stack.sh drive <run> 1 e2e/mbp-army/<file> -g "<title>"`.
- **Proof.** `$ARMY_BASE/<run>/<test-dir>/final.png`, `video.webm`, `trace.zip`, `bridge.log`. The alert text must show the HTTP status, not a blank card.

## Gotchas

- The list case in the draft calls `createBridge(true,false)`; this checkout's `createBridge` takes only one argument, and the supervision fixture seed is not committed, so only the 503 case runs here.
- The heading counts items: `Needs Kevin · N` once a batch loads.
- Draft locators all exist in app source (checked by grep).
