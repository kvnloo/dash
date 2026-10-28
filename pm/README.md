# pm: Dash's projects, features and tasks, in git

`events.jsonl` is an append-only ledger in the zer0-pm format (`kvnloo/_pm`): one recursive
issue record whose type says whether it is a project, feature or task, and one JSON event per
line. The ledger is the only authority. The bridge folds it into the issue graph
(`shared/pm.ts`) and serves it as `GET /pm`; the app's Roadmap screen reads that.

## Adding work

Append lines; never edit or reorder old ones. A change is a new event.

```jsonl
{"v":1,"source":"dash-pm","kind":"issue.created","subject":"issue:dash/chat/x","causation":"<why>","seq":117,"ts_ns":1793150000000000000,"payload":{"id":"dash/chat/x","kind":6,"type":"task","parent":"dash/chat","title":"Short title"}}
{"v":1,"source":"dash-pm","kind":"issue.updated","subject":"issue:dash/chat/x","causation":"<why>","seq":118,"ts_ns":1793150000000000000,"payload":{"id":"dash/chat/x","set":{"priority":"P1","progress":40,"evidence":"…","next":"…","pr":"492","assignee":"hermes:clean","hermes":"t_0123abcd"}}}
{"v":1,"source":"dash-pm","kind":"issue.state","subject":"issue:dash/chat/x","causation":"<why>","seq":119,"ts_ns":1793150000000000000,"payload":{"id":"dash/chat/x","from":"todo","to":"running"}}
```

- Kinds: `issue.created`, `issue.updated` (`set`: `priority`, `progress`, `evidence`, `next`,
  `detail`, `pr`, `assignee`, `hermes`, `roadmap`, `attention: "you"`), `issue.state`
  (`todo`, `running`, `blocked`, `review`, `done`), `issue.parent`, `issue.linked`.
- `kind` is the _pm type id: project 4, feature 5, task 6, defect 7.
- Ids are path slugs (`dash/chat/x`), not _pm's dense integers, so two branches that add
  issues never collide when git merges this file.
- `hermes` links a Hermes kanban card and `roadmap` an item of the host roadmap file. The
  bridge shows their live status on top of what the ledger records.
- No host paths, addresses or secrets: this repository is public.

The tester army checks that this ledger parses with no skipped lines (`e2e/mbp-army/roadmap.spec.ts`).

## Other repositories

A repository joins by adding its own `pm/events.jsonl`. The bridge reads every ledger listed in
`DASH_PM_ROOTS` (`name=/path/to/checkout,…`); by default it reads this checkout. The `fleet`
project tracks work for repositories that have no ledger yet; move it when they do.
