# Upstream gate

Dash is the owner's decision surface. It does not replace the factory registry,
project queues, contribution policy or origin reality. No default branches are merged.

## Agent contract

From this checkout:

```sh
bun bridge/gate.ts propose /absolute/path/proposal.json
bun bridge/gate.ts list pending
bun bridge/gate.ts show <id>
bun bridge/gate.ts post <id> --dry-run
```

`propose -` reads JSON from stdin. Proposal schema: `shared/gate.schema.json`.
All agents (including future z0live/Ripple integrations) use the same contract:

```json
{
  "kind": "pr_comment",
  "target": {"repo": "canonical-origin/repository", "number": 123, "head_sha": "0123456789012345678901234567890123456789"},
  "body": "A concise, factual proposed comment. No labor assignment or ping.",
  "evidence": [{"label": "Exact-head receipt", "url_or_path": "https://github.com/owner/repo/commit/0123456789012345678901234567890123456789"}],
  "origin": {"agent": "hermes", "session": "your-session-id", "created_at": "2026-10-19T00:00:00Z"}
}
```

Resolve `target.repo` from the project's `project_repo` in
`/home/kvn/zer0/oss-factory` using `git show origin/HEAD:factory/projects.json`.
The checkout is another worker's property. Never edit it. The registry is not
copied into Dash. Unknown project targets are refused. Queue URLs come only from
that registry. Missing/legacy/closed queue routing blocks canonical approval;
Dash does not invent a factory fallback issue or create another queue.

`gate approve|reject|edit` deliberately refuse agent CLI use. Only authenticated
paired Dash decisions can change those states. A token, ready label, green CI or
agent-written proposal never supplies human authorization. CompanyOS must remain
view-only (`list`/`show`); future voice decisions must go through an explicitly
authorized human channel, not an `--actor=owner` CLI flag.

## Store and trust boundary

Canonical data:
`/mnt/zer0models/workspace/zer0/data/operations/upstream-gate/`.
`outbox/<uuid>.json` materializes one action. `events.jsonl` is an append-only,
fsynced journal of full snapshots and body-bound decision trails. Journal replay
is authoritative after an interrupted snapshot rename. A cross-process directory
lock serializes decisions and each complete check/post transaction. An abandoned
lock is fail-closed and needs operator inspection, never automatic deletion.

Files/directories are private (0600/0700). The host account can edit its own files
or access pairing credentials: this is **not a sandbox against malicious code
running as the same Unix user**. Agents must use the proposal CLI, not store files
or the owner's paired capability. Paired clients are trusted owner controllers.

## Policy and factory gates

The proposal command captures current target CONTRIBUTING, AGENTS and PR-template
blobs through REST, including `.github/PULL_REQUEST_TEMPLATE/`. It pins content
hashes. Missing or unrecognized policy is conservative, never automatically bulk
safe. Human-authorship requirements clear generated body text and disable bulk.
CLA/DCO/vouch/scope requirements also disable bulk; a tap is not a legal attestation.
Policy extraction is conservative pattern matching, not a substitute for reading
linked rules and checking the action-specific policy. The owner must review those
rules; a restrictive or uncertain result stays individual.

Mentions outside code/scoped package syntax are stripped on proposal/edit.
A deterministic tone gate rejects obvious labor assignment, internal queue/matrix
language and multiple asks before approval. The confirmation additionally asks the
owner to check the complete seven-point factory tone gate: peer framing, no labor
assignment, no internal goal leakage, smallest optional ask, self-service first,
local voice and easy decline. Regexes cannot establish those semantic facts.

New PR/branch proposals, and comments unless explicitly scoped as `intent:"existing_review"`, sweep all open factory-owned origin PRs before approval
and execution: conversation/policy comments, latest submitted reviews, inline
comments, mergeability and checks. REST cannot prove inline-thread resolution, so
existing inline threads block new contributions until canonical reconciliation is
implemented. Unknown state fails closed. Existing-PR replies are not a license to
open a new contribution while review feedback remains unresolved.

## Human decisions and execution

`DASH_GATE_ENABLED=1` enables the authenticated WebSocket additions. Existing
protocol v1 fields continue to parse. `gate_list` subscribes to snapshots;
`gate_decide` carries approve(ids), reject(id,reason) or edit(id,body);
`gate_post` checks/posts one approved item. Status/error messages are separate
from chat turns. Reconnect reloads the authoritative outbox.

There are two independent operator switches, both off by default:

- `DASH_GATE_OWNER_DECISIONS=1`: genuine owner approvals publish a canonical
  `oss-factory:v1` **decision** receipt on the project's existing coordination
  issue. It records Kevin, exact action/target/body digest, work/evidence URLs,
  one-execution scope and a 24-hour expiry. Full readback is required before
  locally granting approval. Rehearsals never create human-decision receipts.
- `DASH_GATE_LIVE=1`: allows the executor to write approved actions. The phone
  preview launcher **always forces posting off**. Live CLI execution additionally
  requires `post <id> --live`; it still requires a valid canonical decision.

Approval does not immediately post. Editing invalidates approval. Human-text
items require an actual owner edit in Dash, with a matching digest in the trail.
Live execution verifies canonical receipt digest/expiry and later revocation
signals, then refreshes target policy, archived/open state, pinned head and
identical existing comments. Drift is stale, not an invitation to retry.

A successful write requires exact target readback and a GitHub URL receipt.
An attempt is journaled **before** the remote mutation. Ambiguous or failed writes
remain failed; they cannot be silently retried and need manual reconciliation.
Dry runs retain approved state and a `dry_run:true` receipt with **no invented URL**.
403/429 use Retry-After/reset-aware bounded backoff; long reset windows return a
blocker. GETs use conditional ETags in the running process.

Supported kinds: issue/PR comments, review-comment replies (`comment_id`), draft
PR creation (`head:owner:branch`, `base`, `title`, pinned `head_sha`), ready-for-review,
and non-overwriting remote branch creation. `push_branch` requires its pinned
commit already exist on GitHub; arbitrary local Git object uploads, force pushes
and default-branch updates are deliberately not supported. PR-ready can trigger
repository automation; preserve explicit campaign draft/merge holds.

## Cached seeding and phone preview

```sh
bun bridge/gate-seed.ts /absolute/path/reviewed-snapshot.json
DASH_WEB_DIR=/absolute/path/production-export \
DASH_GATE_OWNER_DECISIONS=1 \
DASH_PREVIEW_MANIFEST=/absolute/path/manifest.json \
bun bridge/gate-preview.ts
```

The seeder makes **no network calls or GitHub writes**. A reviewed snapshot has
`candidates[]`: each entry provides registry `project` id, `proposal` (target repo
is overwritten from the registry), captured `rules[{path,text}]` and optional
`stale_reason`. Snapshot provenance must contain current evidence; it is not an
approval or a second project list. Keep private operational snapshots out of Git.

The launcher binds owned web and bridge servers to dynamic tailnet ports, sets
only its exact web Origin, reuses the owner's credential directory unless one is
explicitly supplied, and disables STT/live posting. It never starts/stops Metro or
the existing dash-pair. The manifest includes URLs/PIDs/build SHA, not credentials.
Open `web_url` on the S25 with Tailscale connected. On Pair, enter `bridge_address`
and privately transfer the bootstrap token from the manifest's credential_dir.
Tap **Pair over Tailscale**, then **Approvals**. Never place credentials in URLs,
screenshots, logs, GitHub bodies or chat. This web pairing is separate browser
storage; it does not replace Expo Go's existing bridge settings.

## Evidence and remaining acceptance

`bridge/src/gate/*.test.ts` covers state, human text, policy, canonical envelopes,
mention/tone hygiene, executor failure/dry-run and actual authenticated bridge
bulk/edit/reject. `shared/gate-protocol.test.ts` covers parser boundaries.
Existing full unit/mutation gates remain required. Runtime screenshots, actual
seed counts and S25 limits belong in the exact-head qualification receipt, not
static claims here. Rehearsal fixtures must be unmistakably separate from real
proposals; never manufacture actionable items to meet a bulk-demo count.
