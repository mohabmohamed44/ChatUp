# ChatUp

A production-minded, real-time 1:1 messaging web application — text, images, and voice messages over WebSockets, built as an npm-workspaces monorepo and deployed to Google Cloud Platform.

> Assessment-scoped project. Synthetic data only; no production systems, customer data, or E2EE claims. See `project.md` for the full brief this implementation answers.

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [Tech stack](#2-tech-stack)
3. [Repository layout](#3-repository-layout)
4. [Architecture](#4-architecture)
5. [Journey of a message](#5-journey-of-a-message)
6. [Real-time protocol](#6-real-time-protocol)
7. [Data model](#7-data-model)
8. [Media pipeline](#8-media-pipeline)
9. [Background jobs (BullMQ)](#9-background-jobs-bullmq)
10. [Push notifications (PWA + FCM)](#10-push-notifications-pwa--fcm)
11. [Security](#11-security)
12. [Local development setup](#12-local-development-setup)
13. [Testing](#13-testing)
14. [Load testing (k6)](#14-load-testing-k6)
15. [Deployment on GCP](#15-deployment-on-gcp)
16. [Problems and fixes](#16-problems-and-fixes)
17. [AI usage](#17-ai-usage)
18. [Known limitations](#18-known-limitations)
19. [Requirements traceability](#19-requirements-traceability)
20. [Documentation index](#20-documentation-index)

---

## 1. What it does

Users can:

- Create an account, sign in, and sign out (scrypt-hashed passwords, session cookies).
- View and search conversations with latest-message previews, timestamps, and **unread counts**.
- Find another registered user and start a direct conversation (duplicate 1:1s are impossible by DB constraint).
- Exchange **text**, **image**, and **voice** messages in real time — no refresh needed.
- Edit (15-minute window) and soft-delete their own messages; view per-message info (sent / delivered / read / played timestamps).
- See **online / offline** presence (multi-tab aware, 3 s grace period) and **typing** indicators.
- Distinguish **pending → sent → delivered → read → played** states, plus **failed** with a retry action.
- Load earlier history with cursor pagination, recover missed messages after reconnecting (`message:sync`), get an unread divider, and jump to latest.
- Search message history (full-text with `<mark>` highlight, Arabic-aware) and jump to a specific message.
- Record voice drafts that survive tab closure (IndexedDB).
- Get offline push notifications (FCM) and install ChatUp as a **PWA**.
- Use the app comfortably on desktop and mobile, in **LTR and RTL (Arabic)** — localized timestamps, logical CSS properties, BiDi-safe rendering.

Out of scope (optional extensions not built): group chats, calls, payments, reactions/replies, email verification, password reset, dark mode, E2EE.

---

## 2. Tech stack

| Layer            | Technology                                                                           |
| ---------------- | ------------------------------------------------------------------------------------ |
| Frontend         | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4                        |
| State / data     | `@tanstack/react-query` 5, `idb` (IndexedDB offline cache & voice drafts)            |
| Realtime client  | `socket.io-client` (singleton, cookie auth, infinite reconnect)                      |
| Icons / UX utils | `lucide-react`, `linkify-it`, `clsx` + `tailwind-merge`                              |
| Push (client)    | Firebase JS SDK (Web Push via FCM, VAPID key is `NEXT_PUBLIC_*` only)                |
| Backend          | Node.js 22+, TypeScript (strict, all-ESM), Express 5, Socket.IO 4                    |
| Database         | PostgreSQL 16 via Prisma 7 (`@prisma/adapter-pg`) with versioned migrations          |
| Background jobs  | BullMQ 6 on Redis 7 (sync fallback when Redis is down)                               |
| Thumbnails       | `sharp` (worker-side 320px sibling thumbnails)                                       |
| Media storage    | GCS-compatible object storage (`@google-cloud/storage`; `fake-gcs-server` locally)   |
| Push (server)    | Firebase Admin (`firebase-admin`), disabled by default (`FCM_ENABLED=false`)         |
| Validation       | Zod schemas shared by client and server (`packages/shared`)                          |
| Auth plumbing    | Opaque session cookie (sha256-hashed token in DB), CSRF, structured logging (`pino`) |
| Tests            | Vitest (3 projects), supertest, socket.io-client                                     |
| Load testing     | k6 (TypeScript source, esbuild-bundled)                                              |
| CI/CD            | GitHub Actions (format, typecheck, tests, web build → Artifact Registry → Cloud Run) |
| Local infra      | Docker Compose (postgres :5432, redis :6379, fake-gcs :4443)                         |

Key constraints kept deliberately (see `AGENTS.md`):

- Upload path is **direct multipart** (`multer` → server → `storage.put`), download via **signed GET URLs** (15-minute TTL).
- MIME detection is a **manual magic-byte check** in `media.routes.ts` (no `file-type`/`mime-types`).
- Media logic stays inline in `media.routes.ts` (~150 lines).
- Message **persistence happens inline** (persist-before-ack in the send path) after a load-test finding showed the queue hop hurt ack latency more than it helped — the queue remains for background work.

---

## 3. Repository layout

```
apps/server/          # Node 22+, Express 5, Socket.IO 4, Prisma 7, PostgreSQL 16
  src/main.ts         # entry — boot order: config -> db -> redis -> storage -> http -> io
  src/platform/       # http.ts, config.ts, db.ts, redis.ts, storage.ts (GCS), logger, queue.ts, fcm.ts
  src/modules/        # auth/ users/ conversations/ messages/ media/ presence/
                      # notifications/ search/
  src/realtime/       # io.ts (Socket.IO server + registerSocketAuth + room wiring)
  prisma/             # schema.prisma, migrations/, seed.ts (repeatable synthetic data)
  scripts/            # test-idempotency.ts, test-concurrent-sends.ts, seed-messages.ts, test-fcm.ts

apps/web/             # Next.js 16, React 19, TypeScript, Tailwind 4, React Query 5
  src/app/            # App Router: (auth)/login, (app)/conversations, /conversations/[id],
                      # settings/profile, search, offline
  src/features/       # auth/ conversations/ chat/ profile/ notifications/ (api, hooks, components)
  src/shared/         # lib/socket.ts (singleton), lib/api.ts, lib/format.ts, lib/drafts.ts, providers/
  scripts/generate-sw.mjs  # service worker generation — runs on predev/prebuild, do not skip

packages/shared/      # Single source of truth for contracts — import, don't duplicate
  src/                # auth conversations messages media presence notifications search
                      # realtime.ts constants.ts common.ts

docs/                 # architecture, realtime, security, queues, push-notifications,
                      # fcm-debugging, known-limitations, journal, diagrams/, issues/
load-test/            # k6 TypeScript source + seed-load.ts (100 synthetic users)
.github/workflows/    # ci.yml (quality gates), cd.yml (GCP Cloud Run deploy)
```

---

## 4. Architecture

### 4.1 System architecture and data layer

![System Architecture and DB](docs/diagrams/ChatUp%20System%20Architecture%20and%20DB-Page-1.png)

At a glance:

| Part                  | Location          | Stack                                                                                 |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| Web app               | `apps/web`        | Next.js + React + TypeScript, Tailwind, Socket.IO client, FCM                         |
| API + realtime server | `apps/server`     | Express + Socket.IO, Prisma (PostgreSQL), BullMQ (Redis), GCS storage, Firebase Admin |
| Shared contracts      | `packages/shared` | Zod schemas, event/type definitions consumed by both sides                            |

Local dependencies run via `docker-compose.yml`. **The same code points at real GCP services in production through env vars** (`apps/server/src/platform/config.ts`):

- **HTTP** (`platform/http.ts`): auth, conversations, message history, media upload/download URLs, push acks, search, health (`/health` liveness, `/readyz` readiness + DB check), queue observability.
- **WebSocket** (`realtime/io.ts`): sends, live fan-out, receipts, typing, presence. Authenticated from the session cookie (with a CSRF-token handshake fallback — see [§16.10](#16-problems-and-fixes)); rooms are per-user (`user:<id>`) and per-conversation (`conversation:<id>`).
- **Background jobs** (`platform/queue.ts`): media-processing, read-receipt stamping, offline push fan-out, cleanup, dead-letter. Every enqueue has a **synchronous fallback**, so the app works single-node with Redis down (degraded, not dead).
- **Push**: offline recipients only. Server → FCM → browser service worker.

### 4.2 Module dependency graph

![Module Dependency Graph](docs/diagrams/ChatUp%20Module%20Dependency%20Graph.png)

Modular monolith: feature modules depend inward only; solid arrows are runtime dependencies, dashed are compile-time imports (`packages/shared` types boxed at the center).

### 4.3 Real-time messaging architecture

![Real-Time Messaging Architecture](docs/diagrams/ChatUp%20Real-Time%20Messaging%20Architecture.png)

### 4.4 Message flow sequence

![Message Flow Sequence](docs/diagrams/ChatUp%20Message%20Flow%20Sequence.png)

For the full wire protocol see `[docs/realtime.md](docs/realtime.md)`; queue internals in `[docs/queues.md](docs/queues.md)`; push in `[docs/push-notifications.md](docs/push-notifications.md)`.

---

## 5. Journey of a message

1. **Compose & send.** Client emits `message:send` with `{ conversationId, clientId, kind, body?, attachmentId? }` and renders optimistically as _pending_ (`crypto.randomUUID()` client_id).
2. **Persist.** The inline send path (`modules/messages/messages.service.ts` → `send()`) inserts the row in **one transaction** and bumps the conversation's `lastMessageId` / `lastActivityAt`. Idempotency key: unique `(conversationId, senderId, clientId)` — concurrent retries resolve to the winner row via P2002 catch; retries never duplicate.
3. **Live fan-out.** Server emits `message:new` to the conversation room, carrying `senderName` so recipients can show toasts without an extra lookup. The sender's ack flips _pending → sent_.
4. **Receipts.** Recipients ack delivery; reads fire only when the conversation is open and visible. States: _sent_ (persisted) → _delivered_ (a recipient device acked) → _read_ (viewed in the active, visible conversation — **never** on socket arrival alone) → _played_ (voice message listened to).
5. **Offline branch.** Recipients not connected get an `offline-notifications` job: suppressed if they reconnect first, otherwise an FCM push (sender name as title, 160-char preview as body).
6. **Recovery.** Reconnecting clients pull missed messages via `message:sync` / paginated history (`GET /api/conversations/:id/messages`), so nothing depends on having received the socket event.

---

## 6. Real-time protocol

Rooms (`packages/shared/src/realtime.ts`):

| Room                | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `user:<userId>`     | Directed events: status updates, presence, per-user alerts |
| `conversation:<id>` | Message fan-out, typing, conversation-list updates         |

Client → server (all with acks unless noted):

| Event                                                | Payload                                                      | Ack                  |
| ---------------------------------------------------- | ------------------------------------------------------------ | -------------------- |
| `message:send`                                       | `{ conversationId, clientId, kind, body?, attachmentId? }`   | `Ack<Message>`       |
| `message:new` (delivery ack from recipient)          | `{ message }`                                                | —                    |
| `message:read`                                       | `{ conversationId, messageIds }`                             | `Ack<null>`          |
| `message:sync`                                       | `{ since }` (missed-embedded recovery)                       | `Ack<Page<Message>>` |
| `message:edit` / `message:delete` / `message:played` | sender-only mutations                                        | acks                 |
| `typing:start`                                       | `{ conversationId }` (throttled, room-scoped, auto-expiring) | —                    |
| `presence:snapshot`                                  | online check for a userId list                               | —                    |

Server → client:

| Event                                                   | Payload                                               |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `message:new`                                           | `{ message }` (persisted, signed media URLs attached) |
| `message:status`                                        | delivered/read transitions                            |
| `conversation:created` / `conversation:updated`         | conversation list maintenance                         |
| `presence:update`                                       | `{ userId, status, at }`                              |
| `typing:update`                                         | `{ conversationId, userId, isTyping }`                |
| `message:edited` / `message:deleted` / `message:played` | real-time edit/delete/played propagation              |

Semantics & recovery:

- **Socket auth** runs before `io.on("connection")`: cookie-first, CSRF-token fallback for cross-domain handshakes; unauthorized → `next(new Error("unauthorized"))`; client maps `connect_error === "unauthorized"` to logout + `/login` redirect.
- **Every event is authorized** against the participants table (same as HTTP).
- Ordering is `(createdAt, sequence)`; `Message.sequence` is a BigInt autoincrement giving a stable total order (also the pagination cursor — a long-increment tokenizer).
- Presence derives from authenticated connections with a **3 s grace period** (rides out page refreshes, delivers offline promptly); multi-tab counts all connections.
- Typing is throttled, room-scoped, auto-expiring, never persisted.

---

## 7. Data model

![Data Model ERD](docs/diagrams/ChatUp%20Data%20Model%20ERD.png)

Schema: `apps/server/prisma/schema.prisma` (9 versioned migrations; `migrate deploy` only — never `db push`).

- **User** — unique email, `passwordHash` (Node `crypto.scrypt`: N=16384, r=8, p=1), `displayName`, optional `avatarMediaId`.
- **Session** — `tokenHash` (sha256 of the opaque cookie token), `csrfToken`, `fid` (per-device FCM installation id), expiry + revocation (`session-cleanup` sweeps).
- **Conversation** — `directKey` unique (prevents duplicate 1:1 chats for the same pair), `lastMessageId` + `lastActivityAt` for list ordering.
- **ConversationParticipant** — composite key `(conversationId, userId)`, `lastReadMessageId` (unread counts).
- **Message** — `sequence` (BigInt autoincrement, total order), unique `(conversationId, senderId, clientId)` (idempotency), `kind` enum `TEXT|IMAGE|AUDIO`, soft `editedAt` / `deletedAt`, optional attachment FK.
- **MessageReceipt** — per `(messageId, userId)` delivery / read / played stamps.
- **MediaAttachment** — owner, kind, MIME, size, `storageKey`, lifecycle `PENDING → COMPLETED / ABANDONED`, thumbnail sibling key.
- **PushAck** — service-worker `displayed` / `clicked` beacons, observational only — never drives read state.

Foreign keys, uniqueness constraints, and indexes throughout; auth register, media upload, message send, and receipt upserts are all wrapped in DB transactions. Seed (`npm run db:seed`) is repeatable synthetic data: 2 users + 1 conversation + 12 messages.

---

## 8. Media pipeline

`apps/server/src/modules/media/media.routes.ts`:

- `POST /api/media/:kind` — direct multipart upload via multer; server validates kind, size (`IMAGE_MAX_BYTES` 5 MB, `AUDIO_MAX_BYTES` 10 MB), and **actual content via magic bytes** (JPEG / PNG / GIF / WebP + WebM / MP4 / OGG / MP3). `durationMs` is required for audio.
- Row lifecycle: created `PENDING` → flipped `COMPLETED` after storage write; the row is **rolled back** on storage failure. Abandoned `PENDING` uploads (>1 h, unreferenced) are swept by the `media-cleanup` queue job.
- `GET /api/media/:id` — walks attachment → message → conversation → participants, re-checks membership on every read, returns a **short-lived signed URL** (`MEDIA_URL_TTL_SECONDS`, default 900 s). Non-participant → 403; unattached → 400. Signed URLs cannot be shared across conversations.
- `media-processing` worker derives 320px thumbnails (sharp) at sibling key `<storageKey>-thumb-320` and backfills dimensions; originals are usable immediately (HTTP 201 stays fast, post-processing is async). The sibling key pattern avoids fake-gcs-server's nesting limitation.
- Voice messages: MediaRecorder client-side (WebM in Chrome/Firefox, MP4 in Safari — both accepted), 120 s max enforced client + server, metered playback UI, blue mic icon when played.

---

## 9. Background jobs (BullMQ)

`apps/server/src/platform/queue.ts` — 6 queues with typed payloads, idempotent job ids, per-worker Redis connections, and **sync fallback when Redis is unreachable**:

| Queue                   | Concurrency | Work                                                                              |
| ----------------------- | ----------- | --------------------------------------------------------------------------------- |
| `read-receipts`         | 20          | bulk delivered/read stamping                                                      |
| `offline-notifications` | 5           | FCM push for offline recipients; skips users who reconnected while the job waited |
| `media-processing`      | 5           | sharp thumbnails + dimension backfill                                             |
| `media-cleanup`         | 1           | hourly sweep of stale `PENDING` attachments                                       |
| `session-cleanup`       | 1           | daily sweep of expired/revoked sessions                                           |
| `dead-letter`           | 1           | permanently failed jobs with reason + payload                                     |

Observability: `GET /api/queues/health`. Details in `[docs/queues.md](docs/queues.md)`.

---

## 10. Push notifications (PWA + FCM)

Three paths share one deduped helper (`alertIncomingMessage`): FCM background (service worker), FCM foreground (`onMessage` → toast), and socket alerts for online-but-hidden tabs. Push fires **only for offline recipients**; `PushAck` (`displayed` / `clicked`) is observational and never drives read ticks.

- Service worker is generated at build time (`scripts/generate-sw.mjs` on `predev`/`prebuild`) from `sw.template.js`: no raw `push` listener (the Firebase SDK owns it) and fetch early-returns for `/socket.io/` and `/api/`.
- `useFcmToken.ts`: permission flow from user gestures, token registration, and a reset-once retry on registration failure (`deleteToken` + `deleteInstallations`) — never loops.
- Visibility-aware OS notifications: `alertIncomingMessage` treats the page as visible only when `document.visibilityState === 'visible' && document.hasFocus()`; hidden/minimized pages fall through to `registration.showNotification` (tagged per conversation so rapid messages collapse).
- iOS Safari tabs cannot receive push at all (Apple restriction); the app shows "Add to Home Screen" guidance instead. Platform matrix and Linux PWA setup in `[docs/known-limitations.md](docs/known-limitations.md)`; debugging in `[docs/fcm-debugging.md](docs/fcm-debugging.md)`.

---

## 11. Security

Principles from `docs/security.md`, implemented everywhere:

- **Authorization on every HTTP route and socket event** — conversation membership verified via the participants table; `senderId` from the client is never trusted; status updates are never applied on another user's behalf. Non-participants get 403 on conversation history and media.
- **Auth** — scrypt password hashing, opaque session token (sha256 hash in `Session`), `HttpOnly; Secure; SameSite=None` cookie in production, expiry + revocation, dedicated `x-csrf-token` header on unsafe HTTP requests and the socket CSRF handshake fallback.
- **Rate limits** — `express-rate-limit` on auth endpoints (20/15 min/IP); `helmet`; CORS locked to `CORS_ORIGIN` (+ socket origin config). The global 300 req/min/IP limiter was **removed**: per-IP counting throttled everyone behind shared IPs/NAT (observed under k6 load from a shared egress), and it is not user-scoped. Auth stays IP-limited since it is the brute-force surface.
- **Input validation** — Zod schemas from `@chatup/shared` on every payload; user content rendered as plain text (React escaping) — never as trusted HTML. Linkification rejects `javascript:`, `data:`, `ftp:`, `mailto:`, `file:`, and protocol-relative URLs; only http/https become `<a target="_blank" rel="noopener noreferrer nofollow">`.
- **Uploads** — kind + size limits, magic-byte MIME sniffing (filename Content-Type never trusted), validated audio duration.
- **Secrets** — `.env.example` contains placeholders only; real values stay in gitignored `.env` files or GCP Secret Manager. No session secrets, tokens, message bodies, or signed URLs in logs (pino structured logs); `serviceAccountKey.json` is never committed.
- **Safe errors** — uniform error shape with `Errors.notFound/validation methods`; no stack traces or credential leakage.
- No E2EE claim: transport is HTTPS/WSS and storage is private, but message payloads are server-visible by design.

---

## 12. Local development setup

Prerequisites: Node ≥ 22, Docker (Compose), optionally `k6` for load tests.

```bash
# 1 — install
npm ci

# 2 — local infra: postgres :5432, redis :6379, fake-gcs :4443
docker compose up -d

# 3 — env: copy the canonical placeholder file, then fill values
cp .env.example apps/server/.env         # DATABASE_URL, SESSION_SECRET, REDIS_URL, GCS_* ...
cp .env.example apps/web/.env.local      # NEXT_PUBLIC_* ... (SESSION_SECRET: openssl rand -base64 32)

# 4 — migrate + repeatable synthetic seed (2 users, 1 conversation, 12 messages)
npm run db:setup -w @chatup/server

# 5 — run both (separate terminals)
npm run dev -w @chatup/server     # http://localhost:4000 — tsx watch
npm run dev -w @chatup/web        # http://localhost:3000 — Next dev (generate-sw runs first)

# 6 — verify
curl http://localhost:4000/health   # liveness: 200 if the process is up
curl http://localhost:4000/readyz   # readiness: includes a DB check
```

Script reference (repo root):

```bash
npm run typecheck              # tsc --noEmit across all workspaces
npm run format / format:check  # prettier ({ semi, singleQuote, printWidth: 100, trailingComma: "all" })
npm test                       # vitest run — all projects (shared, server, web)
npm run test:unit              # shared + web only
npm run test:integration       # server only (supertest + socket.io-client, needs docker deps up)
npm run db:migrate | db:seed -w @chatup/server
npm run build -w @chatup/web   # next build (runs generate-sw first)

# load test (k6)
npm run load:seed              # 100 synthetic users + paired 1:1 conversations -> gitignored .sessions.json
npm run load:smoke             # 1-minute smoke profile
npm run load                   # full profile: 100 VUs x 10 minutes
```

Load-test env: `K6_BASE_URL` (default `http://localhost:4000`), `K6_PROFILE` (`smoke | mid | ramp | ramp-rapid | full`), `LOAD_USERS` for seeding. Test DB convention: `chatup_test` (create once, run `prisma migrate deploy` against it).

Two demo accounts come from the seed; the journal's two-browser walkthrough (`docs/journal.md`) covers the full manual verification path: register both → find + start 1:1 → realtime text → image + voice → history survives refresh → presence/typing → receipts → failed retry → reconnect recovery → non-member blocked → desktop + mobile.

---

## 13. Testing

| Suite                          | Runner                                         | Covers                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared` project               | vitest                                         | contracts, realtime event maps, timestamp/localization helpers                                                                                                                  |
| `web` project                  | vitest                                         | hooks, formatters, text/linkify logic                                                                                                                                           |
| `server` project (integration) | vitest + supertest + socket.io-client          | auth/session, membership & authz, persistence & pagination, socket auth + room isolation, media validation + 403s, search module, socket-handshake CSRF fallback (`io.test.ts`) |
| Concurrency script             | `apps/server/scripts/test-concurrent-sends.ts` | 50 parallel sends → 50 unique rows, no dupes (verified: PASS, 949 ms)                                                                                                           |
| Idempotency script             | `apps/server/scripts/test-idempotency.ts`      | same `clientId` twice → one row                                                                                                                                                 |

CI (`.github/workflows/ci.yml`) runs on every push/PR: prettier + typecheck → unit → server integration (postgres:16/redis:7 service containers, `chatup_test` with `migrate deploy`) → web production build. Manual-only checks (mic permission, audio format compatibility, playback) are documented per `AGENTS.md`.

---

## 14. Load testing (k6)

Artillery was replaced by **k6** with a TypeScript source (`load-test/k6/chatup.load.ts`, esbuild-bundled) because k6 has no Socket.IO client — the test drives the **Engine.IO polling transport directly** (`40` handshake → poll drain → emit `42<ackId>` → ack `43<ackId>`, `\x1e` payload batches with balanced-bracket parsing), seeding intent born from two constraints: auth endpoints are rate-limited (VUs reuse pre-seeded sessions), and unsafe HTTP needs the CSRF header.

Gate-preserveive thresholds (`K6_PROFILE=full` = constant 100 VUs × 10 min after warm-up):

```text
http_req_duration{kind:api}  p(95) < 500ms
http_req_failed              rate < 1%
chatup_ack_latency_ms        p(95) < 5s     # persist pipeline latency, not just socket RTT
chatup_sends_failed          count == 0
chatup_idempotent_mismatch   count == 0     # duplicate sends / retry-resolution drift
chatup_history_missing / duplicates  count == 0
```

### Evidence run 1 — first full pass (local, 100 VUs, 10 min, 24,848 sends)

| Metric                         | Result                                                           |
| ------------------------------ | ---------------------------------------------------------------- |
| Checks                         | 24,849/24,849 (100%)                                             |
| Sends                          | 0 failed / 0 missing / 0 dupes / 0 idempotent mismatches         |
| Broadcasts                     | 48,419                                                           |
| HTTP API latency               | p50 ≈ 236 ms, p95 = 407 ms (gate: < 500 ms)                      |
| Ack latency (persist pipeline) | p50 = 1.1 s, p95 = 2.8 s (gate: < 5 s)                           |
| Error rate                     | 0.59%                                                            |
| Server resources               | ≈ 11% CPU avg, ≈ 400 MB RAM; postgres/redis in low single digits |

### Evidence run 2 — the failing run that produced the tuning below

There was an earlier full run that **failed**: 26.7% sends failed (1,395), ack p95 = 13.8 s, API p95 = 4.09 s, 1,778 session drops, 23 idempotent mismatches. The workload design was **never weakened to pass it** (proposals to stretch think time 0.5 s → 5 s and shorten the peak window were rejected); a gate-preserving `K6_PROFILE=ramp` (2 m up, 10 m at 100 VUs, 1 m down) was added alongside untouched `full`.

### What was fixed because of the load tests → [§16.12](#16-problems-and-fixes)

- `message-persistence` worker `lockDuration` 120 s; concurrency kept at 10 (the pg pool caps DB parallelism anyway; more only parks jobs on pool checkout).
- Socket.IO heartbeats: `pingInterval 25s / pingTimeout 60s / upgradeTimeout 30s`, explicit `transports: ['websocket', 'polling']` + `allowUpgrades` (never drop the transport some proxies/k6 rely on).
- Sends moved to inline persistence (ack no longer waits on a queue worker with an 8 s `waitUntilFinished` cap).

Scope notes: evidence is local single-box (not Cloud Run sizing); the sustained profile targets the ≥ 10 min / 100-senders requirement with end-to-end latency p50/p95, success/error rates, CPU/mem, and missing/duplicate accounting — not idle connections.

---

## 15. Deployment on GCP

![GCP Deployment Topology](docs/diagrams/ChatUp%20GCP%20Deployment%20Topology.png)

| Concern        | Service                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend       | Cloud Run (`chatup-web`, Next.js standalone build, Cloud CDN for static assets)                                                                  |
| API + realtime | Cloud Run (`chatup-server`) — `--session-affinity` (sticky) and `--timeout=3600` to keep live socket connections                                 |
| Database       | Cloud SQL for PostgreSQL 16 (persistent storage, versioned migrations via a Cloud Run **job** — `prisma migrate deploy` only, never `db push`)   |
| Redis          | Memorystore for Redis 7 — reached via **Direct VPC egress** (`--network/--subnet/--vpc-egress`, since Cloud Run sits outside the VPC by default) |
| Media          | Cloud Storage (private bucket, signed GET URLs; `GCS_PUBLIC_URL` left empty in prod so real GCS URLs pass through untouched)                     |
| Images         | Artifact Registry                                                                                                                                |
| Secrets        | Secret Manager (`DATABASE_URL`, `SESSION_SECRET`, `REDIS_URL`) — none committed to the repo                                                      |
| Auth for CI    | Workload Identity Federation (no static keys)                                                                                                    |
| Observability  | Cloud Logging (pino structured logs), `/health` (liveness) + `/readyz` (readiness + DB)                                                          |

Pipeline (`.github/workflows/cd.yml`, on push to `main`): build & push both images (linux/amd64) via `build-push-action` → run migration job as the `chatup-run` service account → deploy both services (vars from the GitHub `production` environment) → smoke hits with retries (`/health`, `/readyz`, `/`) to ride out GFE propagation and cold starts.

Earth-moving notes from the deploy itself (all fixed — see §16.13–16.16): the reserved `PORT` env can't be passed to Cloud Run (the platform injects it via `--port`); GCP's edge reserves `/healthz`, so liveness lives at `/`; deploy steps fail without an explicitly configured `CLOUD_RUN_SERVICE_ACCOUNT` (the default compute SA has no Secret Manager access); `CORS_ORIGIN` must include the deployed web URL; cross-domain socket handshakes need the CSRF fallback (§16.10).

Operations:

- **Rollback**: `gcloud run services update-traffic chatup-server --to-revisions <prev>=100` (same for `chatup-web`); migrations are versioned, so a rollback redeploys a prior revision safely.
- **Update**: push to `main` (or `workflow_dispatch`) — CD is idempotent.
- **Database backup/restore**: Cloud SQL automated backups + `gcloud sql backups` restore flow.
- **Socket/upload diagnosis**: check logs for `unauthorized` handshake entries, Redis reachability via `/api/queues/health`, and `readyz` for the DB leg.
- First deploy is bootstrapping: set `CORS_ORIGIN` / `APP_URL` / `NEXT_PUBLIC_API_URL` to the real service URLs (or a custom domain) and re-run — `NEXT_PUBLIC_*` bake into the web image at build time and cannot be changed at runtime.
- Recurring cost scope: Cloud Run (2 services + a short migration job), Cloud SQL, Memorystore, and CDN egress — assessment-scoped with synthetic data only; no unauthorized paid resources.

---

## 16. Problems and fixes

Every fix below was found the hard way and recorded in `docs/journal.md` / `AI_USAGE.md` / `docs/issues/pwa-notifications.md`.

### Dev environment & foundation

1. **Prisma 7 client runtime missing** (`Cannot find module '@prisma/client/runtime/library.js'`) — Prisma 7 requires a driver adapter and a custom client output path. Fix: `@prisma/adapter-pg`, explicit output in `schema.prisma`, updated imports. Also moved seed config from `package.json` to `prisma.config.ts`.
2. **Docker Desktop context override** pointed the CLI at `~/.docker/desktop/docker.sock`; zombie `docker-pr` processes held ports 5432/6379/4443. Fix: revert to the `default` context; free ports with `fuser -k`.

### Auth & frontend semantics

1. **Deleting the session cookie didn't redirect** — React state couldn't know the cookie vanished. Fix: global 401 handling — `apiFetch` dispatches `chatup:unauthorized`; `AuthProvider` listens, clears the user, and the protected layout redirects.
2. **Session-expiry / login-loop races** — `/auth/me` failure could clobber a user set by an in-flight login, and a dead-session logout threw an uncaught `ApiError`. Fix: race-guarded fetch, logout swallows a 401 (expected when the session is already gone).

### Realtime, history & receipts

1. **Pagination cursor was a UUID** — `id > BigInt(before)` compared a UUID column to a number and returned nothing. Fix: paginate by `sequence`, cursor = last sequence (string), `before` schema regex `/^\d+$/`. Verified with 51 messages across two pages (no gaps).
2. **Presence flapped/licked slowly** — 30 s grace hid genuine disconnects behind refreshes and still needed a manual reload. Fix: `PRESENCE_GRACE_MS` 30 s → 3 s; offline now reaches partners in real time without flicker on refresh.
3. **bfcache dropped the socket** silently (Chrome 149+ bfcaches pages with open WebSockets). Fix: disconnect on `pagehide`, reconnect on `pageshow`.

### Messages & UI text features

1. `linkify-it` **imports and removes** — named `import { LinkifyIt }` was `undefined` at runtime; `linkify.add('ftp:', null)` _adds_ with null instead of removing. Fix: default import; `linkify.add('ftp:')` with no second argument.
2. **Corrupted regex escapes** — the arabic/script regex contained literal characters instead of `\uXXXX` ranges. Fix: restored proper ranges (Hebrew, Arabic, Persian, Urdu).
3. **Unbreakable messages** — very long words/URLs overflowed bubbles. Fix: word-boundary truncation via `Intl.Segmenter` (grapheme-safe, never cuts inside a URL), `Read more` toggle, `break-all` on linkified URLs.

### Databases & correctness

1. **Race-y idempotency** — find-then-create could interleave under concurrent retries. Fix: transaction-wrapped send + try/catch on Postgres P2002, resolving duplicate `clientId`s to the winner row. Data integrity fixes landed the same day: atomic register, atomic media upload, shared-timestamp receipt upserts, atomic read markers + participant pointer.
2. **Null** `lastMessageId` **showed "No messages yet"** — a manual SQL cleanup nulled pointers without repopulating them. Fix: repair SQL + a defensive fallback in `loadRowsForUser()` (fetch latest message when the pointer is null), proven by re-nulling and re-testing.

### Queues (BullMQ)

1. `:` **in BullMQ job ids** — every enqueue threw (`Custom id cannot contain :`) and silently fell back to sync, so the queue path was never engaged. Fix: `_` separators.
2. **Thumbnail key nesting** — `<key>/thumb-320` can't nest under an existing object in fake-gcs-server. Fix: sibling key `<key>-thumb-320` (works on emulator _and_ real GCS).
3. **Test-double id mismatch** — `media.routes.test.ts` keyed its fake storage by `att-N` while the record carried the real UUID → update missed → 500. Fix: key by `data.id ?? att-N`.

### Search

1. `GET /api/search/messages` **always 500** — `m.kind = 'text'` versus the `TEXT|IMAGE|AUDIO` enum (case-sensitive) → `22P02` on every request. Fix: uppercase. Also fixed the missing search migration on `chatup_test` (column + trigger absent → CI must `migrate deploy` against the test DB).
2. `/search` **page showed "Route not found"** — double-prefixed path (`/api/api/search/messages`) because `apiFetch` already prepends `/api`. Fix: `apiFetch('/search/messages')`.
3. **Jump-to-message never fired** — effect keyed only on `jumpTo` (ran before history loaded) and referenced consts declared later (TDZ crash). Fix: wait on `[jumpTo, messages.length, isLoading]`, move effect below the hook declaration.

### Packaging, Docker & full-stack images

1. `apps/web/Dockerfile` **had 4 build-breaking bugs** — `/repo/...` COPY paths (WORKDIR is `/app`), nonexistent `npm run build -w packages/shared`, missing `output: "standalone"` in `next.config.ts`, missing `ARG/ENV` for `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`.
2. **Full-stack compose (docker-compose.full.yml) found 3 more** — missing `apps/server/tsconfig.json` / `tsconfig.base.json` COPYs; `RUN --mount=type=cache, target=...` stray space; empty build args rejected by the builder (`local` placeholders required). The web image also missed the shared-format server tsconfig initially. End result: **15/15 checks green on built images** (`chatup-server` 2.2 GB with devDeps for tsx — slim-down open, `chatup-web` 312 MB).
3. **Emulator signed URLs used the internal host** — inside Compose, `signedGetUrl` inherited `http://gcs:4443`, unreachable from browsers. Fix: optional `GCS_PUBLIC_URL` origin override (empty with real GCS — real GCS URLs untouched).

### Deployed behavior (GCP)

1. **Login loop on Cloud Run** — login 200 + cookie set on the web domain, then bounced to `/login`: the socket dials the API domain directly, the cross-domain handshake carries no cookie, `io.use` rejected it, and `AuthProvider` cleared the user. Fix: client sends the **readable CSRF token** in the Socket.IO handshake `auth` payload; server falls back to `validateSessionByCsrf` when the cookie is absent (cookie-first, unchanged for same-domain setups). Covered by `io.test.ts` (cookie ok / csrf-auth ok / wrong-csrf rejected / anonymous rejected).
2. `/healthz` **reserved by GCP edge** — health probes intermittently broke. Fix: moved liveness to `/health` (`/healthz` is a GCP reserved path).
3. **Reserved** `PORT` **rejected** — Cloud Run injects `PORT` itself via `--port`; passing it as an env var fails validation. Fix: dropped from server env vars in CD.
4. **Migrate/deploy 403s** — Cloud Run fell back to the default compute SA after an AR/CD config fix, which has no Secret Manager access. Fix: run Cloud Run jobs and services as the dedicated `chatup-run` service account.
5. **Smoke checks flaky in CD** — GFE propagation and cold starts beat a single curl. Fix: retry smoke curls.
6. **Undefined** `baseURL` **in the periodic API probe** (k6) — fix: read `data.baseUrl`. Also fixed worker defaults for concurrency tuning (§14).
7. **Liveness probe path drift** (from CI/CD history): also fixed the frontend socket URL fallback and confirmed the deployed chunks contained zero `localhost:4000` (the "rewrite falls back to localhost" hypothesis was disproven against the live revision; CORS origin verified complete).

### Load tests & performance

1. **26.7% send failures at 100 VUs** — the full first-pass run failed: acks waited on the queue (`waitUntilFinished`, 8 s cap, then a direct-send fallback against an overloaded DB), while Socket.IO's 20 s ping timeout cleared alive-but-slow polling sessions. Fix set: per §14 (worker `lockDuration` 120 s, heartbeats 25/60/30 s, explicit transports). The **23 idempotent mismatches** were proven _not_ a server dedupe bug: the unique constraint is in schema + init migration and `send()` resolves P2002 races; the 15 s deadline retry path is the plausible source.
2. **Worker/queue tuning under load** — raise concurrency + lock duration and keep realistic think time when an early profile beat itself on the queue hop; adds `K6_PROFILE=ramp` for gate-preserving scenario runs. Also fixed earlier `message persist inline` (§16.31) rather than routing all sends through a queue.
3. **Send persistence reverted to inline** — under load test evidence 26 ms/item and single-node deployments, message send no longer goes through `message-persistence` (kept only for background fan-out work). Load-test tuning later confirmed this was correct: queueing acks costs more latency than inline writes.

### PWA / FCM

1. `fcmregistrations.googleapis.com` **401 on push registration** — stale Firebase installation in a granted-permission profile. Fix: reset-once retry (`deleteToken` + `deleteInstallations`) in `useFcmToken.ts` (FID helper extraction keeps the retry safe), with manual follow-ups documented (VAPID/key config checks, referring-origin allowlist, `CORS_ORIGIN` env check against the deployed web URL).
2. **No OS banner although installed as PWA** — minimized/hidden pages fell through to Firebase's foreground heuristic (`onMessage` fires instead of `onBackgroundMessage`). Fix: single `alertIncomingMessage` funnel keyed on `visibilityState === 'visible' && document.hasFocus()` → `registration.showNotification` (per-conversation tag) for hidden pages. PWA-install vs tab permission differences and Linux/GNOME popup-content setup are documented in `docs/known-limitations.md`.
3. **Missing FCM credential guard** — a missing service-account setup produced confusing runtime errors; the Firebase configuration validation and `FCM_ENABLED=false` default were hardened (validating init + explicit dry-run flag).

### Media, voice, profile & misc UI (from the build journal)

1. **Image upload 404** — `useImageUpload.ts` was missing the `/api` prefix (`POST /media/:kind`); fixed to `POST /api/media/:kind`. Also aligned `ImagePicker`'s `onUploaded` to pass `attachmentId` + `localPreviewUrl` so the optimistic bubble renders the local preview immediately.
2. **Voice timer showed total duration instead of remaining** — now tracks `currentMs` via `onTimeUpdate` and displays `remainingMs` while playing; the progress bar was also invisible (`bg-white/20` on a white bubble) — colors now depend on `isOwn`. The recorder releases the mic on unmount/discard and persists unsent voice drafts to IndexedDB (`chatup-drafts`, 24 h prune).
3. **Profile avatar wiring** — `AuthService` wasn't receiving `StorageService`; `toAuthUser` was sync and returned `avatarUrl: null` (now async with a signed URL); `updateProfile` didn't handle `avatarMediaId` (now validates ownership + `COMPLETED` status); `config.storage.signedUrlTtlSeconds` didn't exist (replaced with `MEDIA_URL_TTL_SECONDS`).
4. **Conversation list actions drifting** — loose `justify-between` siblings for the search/new-chat buttons grouped into one right-aligned actions container; merged a duplicate `lucide-react` import. Plus the pointer-fallback fix (§16.12) and a copy-message toast via a dependency-free `ToastProvider`.
5. **Forward-compat decisions kept** (AGENTS.md contract): direct multipart uploads, manual magic-byte MIME checks, inline `media.routes.ts`, sync fallback for every queue enqueue — all resisted becoming "services" or library-dependent rewrites without a scaling need.

---

## 17. AI usage

Summary (full file: `[AI_USAGE.md](AI_USAGE.md)`); tools: **Kilo Code** (plus the Codex/ChatGPT session that produced `project.md`).

- **Where AI assisted**: monorepo scaffolding, Prisma schema draft (hand-reviewed), Express app factory + health endpoints, GCS storage adapter, shared types, initial web scaffold, GitHub Actions CI/CD, the k6 Engine.IO strategy (no Socket.IO client exists; seeded sessions beat logins given the rate limiter), and load-test remediation implementation.
- **Verification habit**: every AI-written file is read before commit; verified with real commands (`migrate dev` → 8 tables, seed → 2 users + conv + 12 messages, curled health endpoints, `docker compose up -d` → all healthy), and reviewed both workflows against repo scripts/Dockerfiles.
- **Accepted-then-corrected examples**: switched `@aws-sdk/client-s3` → `@google-cloud/storage` (GCP target); standardized health endpoints (K8s-style liveness/readiness with a DB check in readiness); rewrote the seed's broken `promisify` scrypt wrapper; swapped MinIO:9000 → `fsouza/fake-gcs-server`:4443 so local matches production GCS.
- **Rejected AI proposals with reasons**: `maxStalledCount: 0` (fails stalled jobs instead of retrying), `stallInterval` (not a valid BullMQ Worker option), server-side `connectTimeout` (client-only), and a later push to weaken the load-test gate (think time 0.5 s → 5 s; ramp profile peaking only 5 m). Also ruled out `SESSION_SECRET` drift and the localhost-rewrite theory during the deployed-401 investigation before landing the CSRF handshake fix.
- Nothing unverifiable is claimed (no E2EE, no production readiness, no invented load numbers).

---

## 18. Known limitations

- Evidence for the largest k6 run is **local single-box** — not a Cloud Run capacity claim; a prod rerun (`K6_BASE_URL=<deployed-url>`, off-peak) is the remaining step.
- Search: the "Custom range" pill is a no-op (no date pickers); `searchConversations` has no frontend surface; jump-to-message on very old targets may require loading earlier pages first.
- iOS Safari tabs cannot receive push (Apple restriction, Home-Screen install required on iOS 16.4+); Linux installed-PWA notifications need a **separate OS-granted permission** (tabs and installed apps are separate scopes) and GNOME's "Show Message Content in Popups" for body text.
- Voice audio format compatibility is browser-dependent (WebM vs MP4); manual mic/playback checks are documented, not automated.
- `chatup-server:local` is 2.2 GB (keeps devDeps for tsx runtime); slimming is an open follow-up.
- Email verification and password reset are intentionally omitted (documented per brief §6).
- No E2EE; HTTPS + private storage are claimed, transport/server encryption only.
- README communicates Artillery leftovers only where real evidence exists — the CI does not run browser E2E; manual two-user realtime checks plus the prod k6 profile are recommended before a broader launch.

---

## 19. Requirements traceability

| Brief (project.md §)                                                            | Status | Where                                                                |
| ------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| 5–6: Design, auth, sessions                                                     | ✅     | `features/auth`, cookies, scrypt, CSRF; profile editing with avatar  |
| 7: Conversations, preview, unread, pagination, no dup 1:1                       | ✅     | `directKey` unique, `lastReadMessageId`, sequence cursor             |
| 8: Realtime, acks, idempotency, reconnection recovery                           | ✅     | `message:` events, `(conv, sender, clientId)` unique, `message:sync` |
| 9–11: Text / image / voice                                                      | ✅     | composer, magic-byte media validation, MediaRecorder                 |
| 12: Presence, typing, delivered/read                                            | ✅     | connection-derived presence, throttled typing, receipt model         |
| 13: Data model + versioned migrations + seed                                    | ✅     | 9 migrations, repeatable seed                                        |
| 14: Security                                                                    | ✅     | membership authz everywhere, rate limits, helmet, safe errors        |
| 15: ≥ 100 concurrent users under load                                           | ✅     | k6 evidence §14 (+ 50-send concurrency script)                       |
| 16: Testing & quality                                                           | ✅     | §13                                                                  |
| 17: Deployment & operations                                                     | ✅     | §15 (GCP: Cloud Run/SQL/Memorystore/GCS, migrations as job, smoke)   |
| 18: Responsible AI                                                              | ✅     | `AI_USAGE.md` (accepted, rejected, corrected)                        |
| 19: Deliverables                                                                | ✅     | README, `.env.example`, migrations, docs, load scripts, CI/CD        |
| 20 (acceptance): retry-without-dupes, non-member blocked, HTTPS, 100-user repro | ✅     | §16.11 (P2002), §11 (403s), §15 HTTPS, §14                           |

---

## 20. Documentation index

- `[project.md](project.md)` — the developer assessment brief this build answers
- `[docs/architecture.md](docs/architecture.md)` — system topology & data flow
- `[docs/realtime.md](docs/realtime.md)` — wire protocol, event contracts, ordering
- `[docs/security.md](docs/security.md)` — threat model, auth, secrets, CORS
- `[docs/queues.md](docs/queues.md)` — BullMQ internals, sync fallback, observability
- `[docs/push-notifications.md](docs/push-notifications.md)` — FCM + PWA architecture
- `[docs/fcm-debugging.md](docs/fcm-debugging.md)` — FCM troubleshooting playbook
- `[docs/known-limitations.md](docs/known-limitations.md)` — platform matrix, manual setup steps
- `[docs/issues/pwa-notifications.md](docs/issues/pwa-notifications.md)` — push-visibility issue record
- `[docs/journal.md](docs/journal.md)` — full development log (every fix above, in context)
- `[AI_USAGE.md](AI_USAGE.md)` — responsible AI usage record
- `[TODO.md](TODO.md)` / `[TODO_FIX.md](TODO_FIX.md)` — work tracking & post-review checklist
- `[docs/diagrams/](docs/diagrams/)` — diagram sources (`.drawio`) + PNG exports
