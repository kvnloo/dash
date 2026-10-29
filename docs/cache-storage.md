# Conversation storage boundary

Dash keeps host session history as a disposable projection. Android stores it under `FileSystem.cacheDirectory/dash-history-v1/`. Each file holds at most the last 80 settled messages, is conservatively bounded to 256 KiB before JSON allocation, and participates in a maximum of 64 retained entries. An oversized message or nested tool payload is not persisted in this cache. The host still owns the original.

`FileSystem.documentDirectory/dash-conversations-v2/` holds routing metadata, preferences, queued/failed user messages and running-turn replay identities. Host-backed chats also retain locally created completed, interrupted and failed phone turns with their preceding ordering anchors. Assistant tool parts, activity and summaries are not retained there. Pending/streaming assistant projections clear text, sequence and transient status, while user text and delivery flags remain unchanged. Local-only conversations retain their complete history. A session identifier alone is not evidence of host history support; only registered harness routes are treated as host-backed. Pairing and composer drafts keep their independent storage.

The native adapter uses asynchronous Expo file I/O. It writes a sibling temporary file, then uses the SDK's rename operation to replace the committed file. Durable and cache writes are serialized. Waiting snapshots coalesce to the newest state. Unchanged conversation references do no serialization or disk writes. Changes to queued or running state do not rewrite an unchanged settled-history cache.

Startup reads the light conversation index and loads active or pending transcripts on demand. Host-backed loads merge the bounded cache even when durable phone turns already exist. Shared message IDs keep cache order and newer durable content; durable-only rows follow their nearest shared predecessor. An unopened index stub must read and preserve its durable transcript before a roster-driven save. Unreadable durable data fails the save rather than being overwritten. Corrupt or missing cache files remain disposable. Late loads merge with current messages instead of replacing concurrent changes.

Native history replies are ordered windows, not deletion lists. A lagging journal cannot erase a completed phone reply. Ordered display alignment consumes repeated prompts separately and retains the phone's richer text when native assistant rows are partial, multipart or truncated. This alignment does not attest native message identity. Completed visible phone text remains durable until reconciliation; unlike the disposable cache, that retained text has no eviction cap. It must not be silently clipped to resolve storage pressure.

## Migration and recovery

Small settings and active IDs are read independently from legacy transcripts. A CursorWindow failure in the legacy conversation key must not block pairing or startup. The unreadable legacy value is preserved until recovery is committed.

Readable legacy conversations migrate to separate files before the old key is removed. Duplicate client IDs are assigned deterministic recovered IDs without changing their host routing. Active selection retains the original first match. This prevents two legacy rows from overwriting one file.

An oversized legacy AsyncStorage value cannot be recovered through Android's existing CursorWindow-backed getItem API. `scripts/recover-conversation-storage.ts` accepts an authorized private JSON export, uses the production persistence implementation, checks the full conversation count and exact local-only round trips, and writes a completion marker last. Recovery is not an excuse to clear the app database. Preserve pairing, drafts and unuploaded files.

The completion marker lets an installed client finalize that explicit recovery without rereading the oversized row. Migration cleanup runs once, rather than deleting any legacy value an older rollback version might later write.

## Verification

The tester army is the verification route:

```sh
bun run test
```

`history-merge.spec.ts` exercises partial, multipart and truncated remote journals, repeated prompts, and stopped/error turns through the real UI and isolated bridge. `history-reload.spec.ts` exercises active/nonactive offline reload and an unopened host chat's roster-driven save. The bridge is stopped before offline assertions so a fresh network history cannot mask cache loss. These web journeys do not prove Android disk latency, native restart performance or physical-device acceptance. A release still requires complete army coverage for the exact commit and O15 approval.
