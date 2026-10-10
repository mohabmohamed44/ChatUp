# ChatUp Architecture

How the system fits together: processes, data flow, and where code lives.
For queue internals see [`queues.md`](./queues.md); for the wire protocol see
[`realtime.md`](./realtime.md); for push see [`push-notifications.md`](./push-notifications.md).

## 1. At a glance

ChatUp is an npm-workspaces monorepo (`node >= 22`):

| Part                  | Location          | Stack                                                                                                   |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------------------- |
| Web app               | `apps/web`        | Next.js + React + TypeScript, Tailwind, Socket.IO client, Firebase Cloud Messaging                      |
| API + realtime server | `apps/server`     | Express + Socket.IO, Prisma (PostgreSQL), BullMQ (Redis), GCS-compatible object storage, Firebase Admin |
| Shared contracts      | `packages/shared` | Zod schemas, event/type definitions consumed by both sides                                              |

Local dependencies run via `docker-compose.yml`: PostgreSQL 16, Redis 7,
and `fake-gcs-server` (stands in for Google Cloud Storage). The same code
points at real GCP services in production through env vars
(`apps/server/src/platform/config.ts`).

## 2. Runtime topology

```text
                    +------------------+
                    |   Browser (PWA)  |
                    |  Next.js pages   |
                    |  Socket.IO client|
                    |  Service worker  |
                    +--+-----+-----+---+
                       |     |     |
              HTTP API |     | WS  | Web Push (FCM)
                       |     |     |
                    +--v-----v-----v---+
                    |  Express server  |
                    |  Socket.IO server|
                    +--+-----+-----+---+
                       |     |     |
            +----------v+ +--v--+ +v------------+
            | PostgreSQL| |Redis| | GCS / fake- |
            | (Prisma)  | |(jobs)| | gcs-server |
            +-----------+ +-----+ +------------+
                                                \
                                                 \-- Firebase (FCM send API)
```

- **HTTP** (`apps/server/src/platform/http.ts`): auth, conversations, message
  history, media upload/download URLs, push acks, health (`/healthz`,
  `/readyz`), queue observability (`docs/queues.md`).
- **WebSocket** (`apps/server/src/realtime/io.ts`): sends, live fan-out,
  receipts, typing, presence. Authenticated from the session cookie; rooms are
  per-user (`user:<id>`) and per-conversation (`conversation:<id>`,
  `packages/shared/src/realtime.ts`).
- **Background jobs** (`apps/server/src/platform/queue.ts`): message
  persistence, read-receipt stamping, offline push fan-out, media processing,
  cleanup, dead-letter. Every enqueue has a **synchronous fallback**, so the
  app works single-node with Redis down (degraded, not dead).
- **Push**: offline recipients only. Server → FCM → browser service worker
  (`apps/web/scripts/sw.template.js` → generated `apps/web/public/sw.js`).

## 3. The journey of a message

1. **Compose & send.** Client emits `message:send` over the socket with
   `{ conversationId, clientId, kind, body?, attachmentId? }` and renders
   optimistically as _pending_.
2. **Persist.** The `message-persistence` worker (or the sync fallback)
   inserts the row in one transaction and bumps the conversation's
   `lastMessageId`/`lastActivityAt`. Idempotency key:
   `(conversationId, senderId, clientId)` unique constraint — retries reuse the
   winner's row instead of duplicating
   (`apps/server/src/modules/messages/messages.service.ts` → `send()`).
3. **Live fan-out.** Server emits `message:new` to the conversation room.
   Online members render it immediately; the sender's ack flips _pending_ →
   _sent_. The broadcast also carries `senderName` so online recipients can
   show the sender in toasts without an extra lookup.
4. **Receipts.** Recipient clients ack delivery (`message:new` ack / queued
   `read-receipts` jobs) and send `message:read` when the conversation is
   visible. States: _sent_ (persisted) → _delivered_ (a recipient device
   acked) → _read_ (viewed in the active, visible conversation).
5. **Offline branch.** Recipients not connected get an `offline-notifications`
   job: suppressed if they reconnected first, otherwise an FCM push with the
   sender's name as title and a 160-char preview as body
   (`apps/server/src/platform/queue.ts` → `notifyWorker`).
6. **Recovery.** Reconnecting clients pull missed messages via `message:sync`
   / paginated history (`GET /api/conversations/:id/messages`), so nothing
   depends on having received the socket event.

## 4. Data model (PostgreSQL via Prisma)

Schema: `apps/server/prisma/schema.prisma`. The core:

- `User` — email (unique), `passwordHash` (scrypt), `displayName`, optional avatar.
- `Session` — `tokenHash` (sha256 of the opaque token), `csrfToken`, `fid`
  (FCM installation id per device), expiry/revocation.
- `Conversation` — `directKey` (unique, prevents duplicate 1:1 chats),
  `lastMessageId` + `lastActivityAt` (list ordering).
- `ConversationParticipant` — composite key `(conversationId, userId)`,
  `lastReadMessageId` (unread counts).
- `Message` — `sequence` (BigInt autoincrement, total order),
  `(conversationId, senderId, clientId)` unique (idempotency), soft
  edit/delete (`editedAt`/`deletedAt`), optional attachment.
- `MessageReceipt` — per `(messageId, userId)` delivery/read/played stamps.
- `MediaAttachment` — owner, kind, MIME, size, `storageKey`, lifecycle
  (`PENDING → COMPLETED / ABANDONED`), thumbnail sibling key.
- `PushAck` — service-worker beacons (`displayed`/`clicked`), observational
  only — never drives ticks.

## 5. Media

Uploads go to private GCS objects, never the database
(`apps/server/src/modules/media/media.routes.ts`):

- Client requests/uploads via `POST /api/media/:kind`; server validates kind,
  size (`IMAGE_MAX_BYTES` 5 MB, `AUDIO_MAX_BYTES` 10 MB), and content.
- Originals are usable immediately; the `media-processing` worker derives
  thumbnails/dimensions (sharp) at sibling key `<storageKey>-thumb-320`.
- Reads use short-lived signed GET URLs (`MEDIA_URL_TTL_SECONDS`, default
  15 min); `GET /api/media/:id` re-checks conversation membership, so URLs
  can't be shared across conversations. Abandoned `PENDING` uploads are swept
  by `media-cleanup`.

## 6. Presence, typing, notifications

- **Presence** derives from authenticated socket connections with a grace
  period (brief blips don't flap status); multi-tab stays online while any
  connection lives (`apps/server/src/modules/presence/`).
- **Typing** is throttled, room-scoped, and auto-expires — never persisted.
- **Notifications** have three paths sharing one helper: FCM background
  (service worker), FCM foreground (`onMessage` → toast), and socket alerts
  for online-but-hidden tabs. Details in
  [`push-notifications.md`](./push-notifications.md).

## 7. Scaling beyond one instance

What already works: stateless HTTP handlers, Redis-backed BullMQ, and the
Socket.IO `redis-adapter` (when Redis is up, rooms span instances —
`docs/queues.md`).

What to change for multi-instance:

1. **Sticky sessions or adapter** — with the `redis-adapter` no stickiness
   is needed for correctness; without it, put socket traffic behind
   least-connections stickiness.
2. **Presence in Redis** — connection counts must be shared, not per-process.
3. **Single-flight workers** — BullMQ concurrency is already the mechanism;
   keep `offline-notifications` at low concurrency to avoid duplicate pushes.
4. **Read-model caching** — conversation lists are `lastActivityAt`-ordered
   queries; add a cache or covering index before sharding reads.

Load-test evidence and targets belong next to the Artillery setup at the repo
root (`artillery` devDependency, `vitest` projects per workspace).
