# Conversation storage boundary

Dash keeps host session history as a disposable projection. Android stores it under `FileSystem.cacheDirectory/dash-history-v1/`. Each file holds at most the last 80 settled messages, is conservatively bounded to 256 KiB before JSON allocation, and participates in a maximum of 64 retained entries. An oversized message or nested tool payload is not persisted in this cache. The host still owns the original.

`FileSystem.documentDirectory/dash-conversations-v2/` holds routing metadata, preferences, queued/failed user messages and running-turn replay identities. Local-only conversations retain their complete history here. A session identifier alone is not evidence of host history support; only registered harness routes are treated as host-backed. Pairing and composer drafts keep their existing independent storage.

The native adapter uses asynchronous Expo file I/O. It writes a sibling temporary file, then uses the SDK's rename operation to replace the committed file. Durable and cache writes are serialized. Waiting snapshots coalesce to the newest state. Unchanged conversation references do no serialization or disk writes. Changes to queued or running state do not rewrite an unchanged settled-history cache.

Startup reads durable records in batches of eight, then loads only the active host history. Other cache entries load when selected. Corrupt or missing cache files fall back to host history. A late cache response cannot replace a newer network response. The bridge requests empty active history for all supported harnesses, not only Hermes.

## Migration and recovery

Small settings and active IDs are read independently from legacy transcripts. A CursorWindow failure in the legacy conversation key must not block pairing or startup. The unreadable legacy value is preserved until recovery is committed.

Readable legacy conversations migrate to separate files before the old key is removed. Duplicate client IDs are assigned deterministic recovered IDs without changing their host routing. Active selection retains the original first match. This prevents two legacy rows from overwriting one file.

An oversized legacy AsyncStorage value cannot be recovered through Android's existing CursorWindow-backed getItem API. `scripts/recover-conversation-storage.ts` accepts an authorized private JSON export, uses the production persistence implementation, checks the full conversation count and exact local-only round trips, and writes a completion marker last. Recovery is not an excuse to clear the app database. Preserve pairing, drafts and unuploaded files.

The completion marker lets an installed client finalize that explicit recovery without rereading the oversized row. Migration cleanup runs once, rather than deleting any legacy value an older rollback version might later write.

## Verification

Run through the owner's worker route:

```sh
fleet-build --node mbp --cpus 2 --mem 3G --fetch .cache-receipts --out <receipt-directory> -- bash scripts/verify-cache-persistence.sh
```

The gate includes focused storage tests, the existing application suite, strict typechecks, lint, the mutation suite, Android export and a seven-trial synthetic persistence benchmark. The benchmark uses an in-memory file adapter to count serialization/write amplification. Its timing is not Android disk latency, cold-start time or frame performance.

On the phone, verify both physical directories, legacy-key removal, unchanged pairing/draft records, host refetch after removing only the history cache, and absence of CursorWindow errors during restart. Do not claim a native performance improvement from desktop tests alone.
