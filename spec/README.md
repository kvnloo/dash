# Current owner requirement crosswalk

[`owner-requirements.json`](owner-requirements.json) maps the supplied `DA-*`
owner ledger rows to spec items, tracked implementation files and test
declarations. This is separate from the historical `DF-*` feature/replay
snapshot above. A traceable item is not necessarily shipped or device-proven.

For new owner ledger imports, add the exact IDs to the checker's imported ID
set and add their asks and links to the crosswalk. Product behavior must cite
tester-army tests by Playwright's config-relative file and exact leaf title;
DA-071 itself is about CI tooling and cites the law checker regressions.
Formal laws CI discovers actual Playwright declarations and rejects missing,
stale, duplicate-title (within a file), and statically skipped test references.
O15 still requires actual passing army results on the exact commit.
