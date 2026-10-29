# Conversation storage boundary

Dash keeps host session history as a disposable projection. Android stores it under `FileSystem.cacheDirectory/dash-history-v1/`. Each file holds at most the last 80 settled messages, is conservatively bounded to 256 KiB before JSON allocation, and participates in a maximum of 64 retained entries. An oversized message or nested tool payload is not persisted in this cache. The host still owns the original.

`FileSystem.documentDirectory/dash-conversations-v2/` holds routing metadata, preferences, queued/failed user messages and running-turn replay identities. It also retains completed, interrupted and failed phone-only turns, their user messages and native ordering anchors when the host has not saved an equivalent complete turn. Host-owned tool payloads remain outside the durable projection. Local-only conversations retain their complete history here. A session identifier alone is not evidence of host history support; only registered harness routes are treated as host-backed. Pairing and composer drafts keep their existing independent storage.

The native adapter uses asynchronous Expo file I/O. It writes a sibling temporary file, then uses the SDK's rename operation to replace the committed file. Durable and cache writes are serialized. Waiting snapshots coalesce to the newest state. Unchanged conversation references do no serialization or disk writes. Changes to queued or running state do not rewrite an unchanged settled-history cache.

Startup reads durable records in batches of eight, then loads the active and pending transcripts. Other transcripts and cache entries load when selected. Unopened index snapshots cannot replace their durable messages during roster updates. A corrupt unloaded file is preserved and reported after unrelated saves drain. The bounded cache suffix merges after the durable transcript, with shared source ids and native anchors rather than phone/host clock comparisons. Matching cached reply disclosures enrich the durable body without replacing a newer answer. Cache and durable hydration complete before a newly selected chat requests fresh native history.

## Migration and recovery

Small settings and active IDs are read independently from legacy transcripts. A CursorWindow failure in the legacy conversation key must not block pairing or startup. The unreadable legacy value is preserved until recovery is committed.

Readable legacy conversations migrate to separate files before the old key is removed. Duplicate client IDs are assigned deterministic recovered IDs without changing their host routing. Active selection retains the original first match. This prevents two legacy rows from overwriting one file.

An oversized legacy AsyncStorage value cannot be recovered through Android's existing CursorWindow-backed getItem API. `scripts/recover-conversation-storage.ts` accepts an authorized private JSON export, uses the production persistence implementation, checks the full conversation count and exact local-only round trips, and writes a completion marker last. Recovery is not an excuse to clear the app database. Preserve pairing, drafts and unuploaded files.

The completion marker lets an installed client finalize that explicit recovery without rereading the oversized row. Migration cleanup runs once, rather than deleting any legacy value an older rollback version might later write.

## Verification

Run the e2e tester army described in [Testing Dash](../TESTING.md). `history-reload.spec.ts` exercises real browser offline reloads and unopened-chat roster updates. `persistence-lifecycle.spec.ts` checks bounded-cache ordering, disclosure enrichment and failure isolation through the production persistence consumers. These are not Android disk-latency or frame-performance measurements.

Native acceptance must separately verify both physical directories, legacy-key removal, unchanged pairing/draft records, host refetch after removing only the history cache, and absence of CursorWindow errors during restart. Do not clear app data to obtain a passing result. Desktop receipts do not establish native performance or installed-device acceptance.
