# ChatUp Message Queues & GCS

## What runs where

| Path | Mechanism |
|---|---|
| Typing, presence, live `message:new` fan-out | Direct Socket.IO (+ `redis-adapter` when Redis is up, so 2+ instances stay consistent) |
| `message:send` persistence | `message-persistence` queue (BullMQ), idempotent via `(conversationId, senderId, clientId)` unique key; falls back to direct DB write when Redis is down |
| Delivery/read stamping | `read-receipts` queue (debounced, collapsing `read` jobs); direct fallback |
| Offline recipients | `offline-notifications` queue; worker suppresses if the user reconnected (push provider plugs in here — currently a structured log) |
| Image thumbnails + dimensions | `media-processing` queue (sharp); original is usable immediately, thumbnail lands at `<storageKey>-thumb-320` |
| Stale `PENDING` uploads, expired/revoked sessions | `media-cleanup` (30 min) + `session-cleanup` (hourly) repeatable jobs |
| Permanently failed jobs | `dead-letter` queue, inspectable at `GET /api/queues/dead-letter` |

## Operate

- Health: `GET /api/queues/health` → `{ redis, queues: { <name>: { waiting, active, failed } } }`
- All enqueue helpers throw `QueueUnavailableError` when Redis is down; every
  caller falls back to the synchronous path, so the app works (single-node)
  without Redis.
- GCS: `GCS_EMULATOR_URL` points at `fake-gcs-server` locally; unset it in
  production and use Application Default Credentials. Objects are private;
  clients get short-lived signed GET URLs (`MEDIA_URL_TTL_SECONDS`).

## Verified (2026-10-06)

Two-user socket smoke: queued send → realtime match → idempotent retry dedupe →
GCS upload 201 → thumbnail in bucket → all queues drained, 0 failed.
`npm run typecheck` clean. `vitest`: 10/10 pass.

Two queue bugs were found during verification and fixed:

1. **BullMQ rejects `:` in custom job IDs.** Every `queue.add` with a
   `persist:…` / `media:…` / `read:…` jobId threw, so all paths silently fell
   back to synchronous writes. Fixed by using `_`-separated IDs
   (`persist_<conv>_<sender>_<clientId>`, …).
2. **Thumbnail key nested under the object key** (`<key>/thumb-320`), which
   `fake-gcs-server` rejects ("not a directory"). Fixed with a sibling key
   (`<key>-thumb-320`), which also matches real GCS flat-namespace practice.

A pre-existing test failure was fixed separately: the `makeDb` fake in
`media.routes.test.ts` keyed its map by `att-N` while the record carried the
route-supplied uuid (`{ id: 'att-N', ...data }` lets `data.id` win), so the
follow-up `update` missed and returned 500. The fake now keys by the record's
real id (`data.id ?? att-N`), mirroring Prisma with a client-supplied id.
