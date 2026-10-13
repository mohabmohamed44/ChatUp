# AGENTS.md — ChatUp

> Monorepo: real-time 1:1 messaging web app. Production-minded, assessment-scoped.
> Stack is fixed — do not swap it without explicit approval.

## 1. Repo Layout

```
apps/server/          # Node 22+, Express 5, Socket.IO 4, Prisma 7, PostgreSQL 16
  src/main.ts         # entry — boot order: config -> db -> redis -> storage -> http -> io
  src/platform/       # http.ts, config.ts, db.ts, redis.ts, storage.ts (GCS), logger, queues
  src/modules/        # auth/ users/ conversations/ messages/ media/ presence/ notifications/
  src/realtime/io.ts  # Socket.IO server + registerSocketAuth + room wiring
  prisma/             # schema.prisma, migrations/, seed.ts
  scripts/            # test-idempotency.ts, seed-messages.ts
  load-test/          # artillery (if present)

apps/web/             # Next.js 16, React 19, TypeScript, Tailwind 4, React Query 5
  src/app/            # App Router: (auth)/login, (app)/conversations, /[id]
  src/features/       # auth/ conversations/ chat/ (api, hooks, components)
  src/shared/         # lib/socket.ts (singleton), lib/utils.ts (cn), providers/
  scripts/generate-sw.mjs  # runs on predev/prebuild — do not skip

packages/shared/      # Single source of truth for contracts — import, don't duplicate
  src/auth/ conversations/ messages/ media/ presence/ notifications/
  src/realtime.ts constants.ts common.ts
```

Docs: `project.md` (requirements), `docs/architecture.md`, `docs/realtime.md`, `docs/security.md`, `docs/queues.md`, `docs/push-notifications.md`, `AI_USAGE.md`, `TODO.md`, `TODO_FIX.md`.

## 2. Fixed Stack — Do Not Change

- Frontend: React + Next.js + TypeScript, Tailwind, `socket.io-client`, `@tanstack/react-query`, `idb` (offline), `firebase` (push only)
- Backend: Node + Express, Socket.IO, Prisma + versioned migrations, PostgreSQL, GCS-compatible storage, Docker Compose for local deps
- Redis: optional for single instance; required for multi-instance presence / fan-out via `@socket.io/redis-adapter` + BullMQ (degrades to sync fallback when unreachable — keep that fallback)
- Upload path is **direct multipart** (`multer -> server -> storage.put`), download via **signed GET URLs**. Do NOT rewrite to signed PUT URLs.
- MIME detection is **manual magic-byte check** in `media.routes.ts`. Do NOT add `file-type` / `mime-types`.
- Media logic lives inline in `media.routes.ts` (~150 lines) — extract to service only if it grows significantly.

## 3. Commands (repo root `/media/storage/Projects/chatUp`)

```bash
docker compose up -d                    # postgres :5432, redis :6379, fake-gcs :4443
npm run dev                             # server dev (tsx watch)
npm run dev:server                      # same
npm run typecheck                       # all workspaces (tsc --noEmit)
npm run format                          # prettier --write .  (config below)
npm run format:check                    # CI check
npm test                                # vitest run (all projects)
npm run test:unit                       # shared + web only
npm run test:integration                # server only
npm run db:migrate -w @chatup/server    # prisma migrate dev
npm run db:seed -w @chatup/server       # tsx prisma/seed.ts (2 users + 1 conv + 12 msgs)
npm run db:setup -w @chatup/server      # migrate + seed
```

Per-workspace:

```bash
npm run dev -w @chatup/server           # tsx watch src/main.ts
npm run typecheck -w @chatup/server     # tsc --noEmit
npm run test -w @chatup/server          # vitest run
npm run build -w @chatup/web            # next build (runs generate-sw first)
npm run dev -w @chatup/web -- --port 3000
```

Health: `GET /healthz` (liveness, always 200 if process up), `GET /readyz` (readiness + DB check).

## 4. Env & Secrets — Never Commit Real Values

- Root `.env.example` is canonical placeholders-only. `apps/server/.env` and `apps/web/.env.local` are gitignored.
- Required vars: `DATABASE_URL`, `SESSION_SECRET` (≥32 chars, `openssl rand -base64 32`), `REDIS_URL`, `CORS_ORIGIN`, `GCS_PROJECT_ID`, `GCS_BUCKET`, `GCS_EMULATOR_URL=http://localhost:4443` (local only), `MEDIA_URL_TTL_SECONDS=900`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `APP_URL`.
- FCM is optional, disabled by default (`FCM_ENABLED=false`). Frontend VAPID key stays `NEXT_PUBLIC_*` only — never on backend.
- Rules: no secrets / tokens / passwords / message bodies / signed URLs in logs, screenshots, docs, AI prompts, or git. `serviceAccountKey.json` (if present) is never committed.
- Assessment boundary: synthetic data only. No production systems, customer data, or paid resources.

## 5. TypeScript & Style

- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` (use `import type`), `moduleResolution: bundler`, `ES2023`. All packages `type: module` (ESM).
- Prettier: `{ semi: true, singleQuote: true, printWidth: 100, trailingComma: "all" }`. Run `npm run format` before commit; CI runs `format:check` + `typecheck` + tests + web build.
- No `console.log` in committed code (temporary socket-auth logs must be removed). Use `pino` on server.
- No `any` without justification. Validate server inputs with `zod` schemas from `@chatup/shared`; render user content safely (never as trusted HTML).
- Path alias: web uses `@/*`. Shared package exports `./src/index.ts` — import types from `@chatup/shared`, don't redefine `ConversationSummary`, `Message`, `Page<T>`, `MediaUploadResult`.

## 6. Backend Conventions

- Auth: scrypt-hashed passwords, session-cookie (`session` cookie, hashed token in `Session` row). Reuse `hashSessionToken` / `parseSessionCookie` from `auth.session.ts` — don't duplicate. Socket auth (`auth.socket.ts: registerSocketAuth(io)`) must run before `io.on("connection")`, join `user:<userId>`, set `socket.data.userId/sessionId`, reject with `next(new Error("unauthorized"))`.
- Authorization (every HTTP route + socket event): verify conversation membership via participants table; `GET /media/:id` → 403 for non-participants, 400 if unattached; never trust `senderId` from client; never allow status updates on another user's behalf.
- Messages: persist **before** ack. Stable IDs + `clientId` idempotency (retries must not duplicate). Ordering: `(createdAt, id)` or `sequence` — be consistent. Status: `sent` (persisted) → `delivered` (recipient ack) → `read` (visible active conversation only, never on socket arrival alone). `message:sync` for missed-message recovery after reconnect.
- Conversations: prevent duplicate 1:1 for same pair; list sorted by recent activity with preview + unread counts; history paginated (`before`, `limit`, newest-first from DB → chronological in UI).
- Media: `POST /media/:kind` (multer, magic-byte validate JPEG/PNG/GIF/WebP + WebM/MP4/OGG/MP3, size limits, `durationMs` required for audio, `PENDING → COMPLETED`, rollback row on storage failure). `GET /media/:id` returns short-lived signed URL (TTL 900s). Store outside DB. Document abandoned-upload handling.
- Presence/typing: presence from authenticated connections (multi-tab aware + grace period); typing throttled, room-scoped, auto-expire, never persisted.
- Rate-limit auth + messages (`express-rate-limit`), `helmet`, CORS locked to `CORS_ORIGIN`, safe error shapes (no credential/token leakage).

## 7. Frontend Conventions

- Socket singleton in `shared/lib/socket.ts`: `withCredentials: true`, `autoConnect: false`, `reconnection: true, reconnectionAttempts: Infinity`. Connect on `user` set in `AuthProvider`, disconnect on null; `connect_error === "unauthorized"` → `setUser(null)` + redirect `/login`.
- Chat hooks: `useConversations` (fetch + `conversation:updated`), `useConversationMessages` (history, reverse newest-first, dedupe by `id`+`clientId`, `message:new`/`message:status`, `message:sync` on reconnect, `loadMore`), `useSendMessage` (`crypto.randomUUID()` clientId, optimistic `pending` → replace on ack, `failed` + retry button).
- Composer: Enter sends, Shift+Enter newline, empty/whitespace blocked, max length from shared constants, usable on mobile.
- Images: `ImagePicker` (hidden input, client MIME/size pre-check) → `useImageUpload` (dimensions via `Image`+objectURL, `XMLHttpRequest` for progress, revoke URLs) → `ImageMessage` (max-w 320px, placeholder, lightbox with ESC/outside-close). Don't set `Content-Type` manually on multipart.
- Voice: `useVoiceRecorder` (MediaRecorder, timer, 120s auto-stop, cancel releases stream) → `VoiceRecorder` UI (idle/recording/preview) → `VoiceMessage` (play/pause, progress, `m:ss`). Handle mic denial + unsupported browsers. HTTPS required for mic in prod.
- Styling: Tailwind + `cn(twMerge(clsx()))`, `lucide-react` icons, original ChatUp branding (no WhatsApp copy). Required states: empty/loading/error/disconnected/retry. Keyboard-accessible, visible focus, contrast-safe.

## 8. Data, Migrations, Seed

- Prisma models cover users, sessions/refresh tokens, conversations, participants, messages, media attachments, delivery/read tracking with FKs, uniqueness (no dup 1:1), indexes.
- Always use versioned migrations (`prisma migrate dev` / `deploy` in prod), never `db push` for shared branches. Seed is repeatable synthetic data only.
- Test DB: `chatup_test` (create once, run `migrate deploy` against it).

## 9. Testing

- Vitest projects: `shared`, `server`, `web` (root `vitest.config.mts`). Server integration uses `supertest` + `socket.io-client`; web E2E uses Playwright (`chromium, firefox`); load uses Artillery (sustained ≥10 min, 100 active senders, report p50/p95, success/error rates, CPU/mem, missing/dupes).
- Must cover: auth/session, membership/authz, persistence/pagination, socket auth + room isolation, idempotent retries, delivered/read transitions, media validation + 403, two-user realtime E2E, reconnect recovery, failed-send retry, unread counts, mobile layout.
- Manual-only (document in `docs/testing.md`): mic permission, audio format compat, playback.

## 10. What to Do / Not Do as an Agent

- DO: read `TODO.md` / `TODO_FIX.md` + `docs/journal.md` first; work on one phase/branch at a time (`feature/*`); run `typecheck` + relevant `vitest` + `format:check` before proposing commit; update `docs/journal.md` + `AI_USAGE.md` for non-trivial work.
- DO: keep changes minimal and scoped (`git status` shows only intended files).
- DO NOT: add deps without need (media libs already decided); change ports (3000 web / 4000 api / 5432 / 6379 / 4443); claim E2EE, production-readiness, or load results without evidence; create group chats/calls unless required scope is green and user asks.
- Commit style: `feat(chat): ...`, `feat(media): ...`, `feat(realtime): ...`, `fix(...)`, `test(...)`, `docs(...)`.

## 11. PR / Walkthrough Checklist

Two users register → find + start 1:1 → text realtime (no refresh) → image + voice send/open → history survives refresh → presence/typing correct → sent/delivered/read per definitions → failed retry without dupes → reconnect recovers → non-member blocked (convs + media) → desktop + mobile OK → CI green → HTTPS deploy → 100-user Artillery evidence → docs explain trade-offs/limits.
