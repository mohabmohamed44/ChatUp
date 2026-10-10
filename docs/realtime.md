# ChatUp Realtime Protocol

HTTP endpoints and Socket.IO events: payloads, acks, ordering, and recovery.
Contract source of truth is `packages/shared/src/` (`realtime.ts`,
`messages/`, `presence/`); server enforcement lives in
`apps/server/src/modules/messages/` and `apps/server/src/realtime/io.ts`.

## 1. Transports

- **HTTP** (`/api`, same origin as the web app): auth (`/auth/*`), user
  search (`/users/search`), conversations (`/conversations`,
  `/conversations/direct`), history
  (`/conversations/:conversationId/messages`), media (`/media/:kind`,
  `/media/:id`), push acks (`/notifications/push-ack`), queue/health
  endpoints. Auth via session cookie; mutating calls additionally require the
  `x-csrf-token` header (see [`security.md`](./security.md)).
- **Socket.IO**: everything live. Authenticated during the handshake from the
  session cookie (no client-supplied user id). Rooms: `user:<id>` (personal)
  and `conversation:<id>` (member-only; the server decides membership).

## 2. Message send flow (the important one)

Client → `message:send` `{ conversationId, clientId, kind, body?,
attachmentId? }`, server acks `Ack<Message>`:

| Step     | What happens                                                                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validate | Zod schema + `requireMembership(conversationId, sessionUserId)`                                                                                                                                                 |
| Persist  | Transaction: insert message + update conversation's `lastMessageId`/`lastActivityAt`. Unique `(conversationId, senderId, clientId)` → a retried `clientId` returns the original row (idempotent, no duplicates) |
| Ack      | Server ack carries the persisted `Message`; client flips _pending_ → _sent_. No ack without persistence                                                                                                         |
| Fan-out  | `message:new { message, senderName? }` to the conversation room. Recipient clients ack receipt (drives _delivered_)                                                                                             |

Queue path: `message:send` may route through the `message-persistence`
BullMQ queue first (same idempotency key as job id); with Redis down it falls
back to a direct write. Either way the ack semantics are identical.

## 3. Event reference

### Client → server

| Event                             | Payload                                                           | Ack                  | Notes                                                      |
| --------------------------------- | ----------------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `message:send`                    | `SendMessagePayload` (conv id, `clientId`, kind, body/attachment) | `Ack<Message>`       | Retries reuse `clientId`; edit/delete use their own events |
| `message:new` (client echo)       | `{ message }`                                                     | `()`                 | Delivery confirmation for a received broadcast             |
| `message:read`                    | `ReadReceiptPayload` (conv id, up to message id)                  | `Ack<null>`          | Only marks what the user actually viewed                   |
| `message:sync`                    | `MessageSyncPayload` (conv id, cursor)                            | `Ack<Page<Message>>` | Missed-message recovery after reconnect                    |
| `message:edit` / `message:delete` | id + conv id (+ new body for edit)                                | `Ack<Message>`       | Owner-only, 15-min edit window; renders tombstones         |
| `message:played`                  | voice message id                                                  | `Ack<null>`          | Played receipts for audio                                  |
| `typing:start`                    | `{ conversationId }`                                              | —                    | Throttled client-side; server expires stale flags          |
| `presence:snapshot`               | `string[]` (user ids, ≤200)                                       | —                    | One-shot presence for the visible list                     |

### Server → client

| Event                                | Payload                                | Notes                                                            |
| ------------------------------------ | -------------------------------------- | ---------------------------------------------------------------- |
| `message:new`                        | `{ message, senderName? }`             | `senderName` lets toasts/alerts show the sender without a lookup |
| `message:status`                     | delivery/read transitions              | Reconciles ticks across tabs and reconnects                      |
| `message:edited` / `message:deleted` | updated message / tombstone            | Keeps history consistent                                         |
| `typing:update`                      | `{ conversationId, userId, isTyping }` | Room-scoped to the conversation                                  |
| `presence:update`                    | `{ userId, status, at }`               | Online/offline with grace period                                 |

## 4. Ordering, history, and reconnects

- **Order**: `Message.sequence` (BigInt autoincrement) is the total order;
  history pages by `(conversationId, sequence)` with `HISTORY_PAGE_SIZE`
  limits (`packages/shared/src/constants.ts`). Equal timestamps never decide
  order.
- **History**: `GET /api/conversations/:conversationId/messages` (cursor
  pagination, survives refresh/reauth). Conversation list is sorted by
  `lastActivityAt` with preview + unread counts.
- **Reconnects**: Socket.IO reconnects automatically; on rejoin the client
  calls `message:sync` (and refetches the visible page) so anything missed
  while offline appears. FCM covers the truly-offline case
  ([`push-notifications.md`](./push-notifications.md)).
- **Optimistic UI**: sends render instantly as _pending_; the server ack (or
  the echoed `message:new`) reconciles them by `clientId`. Failed sends show
  retry, and retry reuses the same `clientId` — safe by construction.

## 5. Presence & typing semantics

- Presence = authenticated socket liveness with a grace timeout; a user with
  any live tab/device stays online. `presence:snapshot` bootstraps lists;
  `presence:update` streams changes.
- Typing is ephemeral: throttled emits, room-scoped broadcast, server-side
  expiry. Never stored, never pushed.

## 6. Failure modes

- Redis down → queues fall back to synchronous paths (single-node correct,
  lower throughput). Enqueue helpers throw `QueueUnavailableError` only to
  trigger the fallback, never to fail the request.
- Ack timeout → client keeps the message _pending_ with retry; server-side
  idempotency makes the retry safe.
- Socket down but HTTP up → history/polling still works; socket-only actions
  (send, typing) show disconnected state with retry.
