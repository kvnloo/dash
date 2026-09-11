# Dash rollout channels

Not a second contribution loop. [Verified OSS Loop](https://github.com/kvnloo/verified-oss-loop) still owns claims, receipts, and merge of `dev`/`main`. This file is how Dash uses scheme **rolling**.

```bash
python3 .verified-oss-loop/rollout.py show
```

| Branch | Role |
|---|---|
| **preview** | Day-pass feature PR target. Automerge after checks (`automerge-preview.yml` uses `--auto`). |
| **nightly** | Overnight AI and OMP fast-forward. Former `overnight/critical-path-*` consolidates here. |
| **dev** | Gated. Workers never merge. Already existed; do not force-update it from this script. |
| **main** | Production. Maintainer only. Never force-push. |

Ladder:

```text
feature branch
  → preview   (day pass, automerge on rolling)
  → nightly   (promote-preview.yml, or overnight PR)
  → dev       (gated)
  → main      (gated)
```

Create missing channels once (does not touch `main`):

```bash
bash scripts/ensure-rollout-branches.sh --root . --push
```

Kit reference: [docs/rollout.md](https://github.com/kvnloo/verified-oss-loop/blob/main/docs/rollout.md). Product map: [docs/system.md](system.md).
