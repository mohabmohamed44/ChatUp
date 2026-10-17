# AI Usage

## Tools used

- Kilo Code

## What AI assisted with

- Monorepo scaffolding (folders, package.json, tsconfig)
- Prisma schema draft (I reviewed and adjusted field names and relations)
- Express app factory and health endpoints in `platform/http.ts`
- GCS storage adapter in `platform/storage.ts`
- Shared types in `packages/shared`
- Initial web scaffold (I made most edits to the web layer myself)
- GitHub Actions CI/CD workflows (Cloud Run CD to match the GCP direction)
- k6 load test in TS: I chose Engine.IO polling for sends after finding
  k6 has no Socket.IO client; I picked seeded sessions over live logins
  because of the auth rate limiter

## How I verified AI output

- Ran `npx prisma migrate dev` and confirmed 8 tables exist
- Ran `npx prisma db seed` and confirmed 2 users + 1 conversation + 12 messages
- Curled `/healthz` and `/readyz` — both returned 200
- Ran `docker compose up -d` and confirmed Postgres, Redis, GCS emulator healthy
- Read every file the agent wrote before committing
- Reviewed both workflows against repo scripts and Dockerfiles

## Corrections I made

- The agent initially used `@aws-sdk/client-s3` for media storage. I asked it to switch to `@google-cloud/storage` because ChatUp deploys to GCP, not AWS.
- The agent's health endpoints were originally `/health`. I standardized on `/healthz` (liveness) and `/readyz` (readiness) following Kubernetes conventions, and added a database check to `/readyz`.
- The seed script had a scrypt typing issue where `promisify` lost the options parameter. I rewrote the wrapper with an explicit Promise and typed parameters.
- The storage adapter originally talked to MinIO on port 9000. I asked the agent to swap the local emulator to `fsouza/fake-gcs-server` on port 4443 so local behavior matches production GCS.

## What I can explain in the walkthrough

- Every file in `apps/server/src/platform/` and why it exists
- The Prisma schema and how the tables relate
- The Docker Compose setup and why each service is needed
- The health check design and why liveness vs readiness matters

## What I do not claim

- I did not hand-write every line. AI was used as a productivity tool.
- I will not submit code I cannot explain. If I cannot explain it, I will either learn it or remove it.

## 2026-10-16 — Load-test tuning (persist worker + Socket.IO heartbeats)

- Asked AI to apply the codebase half of the load-test remediation (failed full
  k6 run: 26.7% sends failed, ack p95 13.8s). AI traced the ack path
  (socket send → persist worker → 8s `waitUntilFinished` → direct fallback) and
  the DB unique constraint, then implemented: persist worker concurrency stays
  10 (pg pool caps DB parallelism at 10/instance regardless)
  - `lockDuration` 120s (`apps/server/src/platform/queue.ts`); Socket.IO
    `pingInterval/pingTimeout/upgradeTimeout` + explicit transports
    (`apps/server/src/realtime/io.ts`).
- AI rejected three parts of the proposed fix with reasons: `maxStalledCount: 0`
  (fails stalled jobs instead of retrying), `stallInterval` (not a valid BullMQ
  Worker option), server-side `connectTimeout` (client-only; type rejects it).
- AI verified the 23 idempotency mismatches are not a server dedupe bug (unique
  constraint present in schema + init migration; P2002 resolves to winner row).
- Follow-up: refused a second proposal to weaken the gate (think time 0.5s→5s,
  constant→ramp with only 5m at peak). Instead added `K6_PROFILE=ramp` as a
  gate-preserving extra (2m up, 10m at 100 VUs, 1m down); `full` untouched.
- I reviewed the diff before deploying; verified with `typecheck -w
@chatup/server`, `io.test.ts` 4/4, `load:bundle`, `format:check` (see below).

## 2026-10-15 — PWA push notification visibility fix (issue record: docs/issues/pwa-notifications.md)

- Investigated: Fixes 1–3 from the issue were already implemented in the
  current code, so no code change was needed:
  - Fix 1 (`visibilityState`-aware OS notification): `alertIncomingMessage`
    (`apps/web/src/features/notifications/lib/alertIncomingMessage.ts`) treats
    the page as visible only when `document.visibilityState === 'visible' &&
document.hasFocus()`; both the FCM `onMessage` path
    (`apps/web/src/app/(app)/layout.tsx`) and the socket path
    (`useIncomingMessageAlerts.ts`) funnel through it (deduped by message id),
    falling back to `registration.showNotification(...)` with a per-conversation
    `tag` when hidden/minimized.
  - Fix 2 (SW fetch guard): early return for `/socket.io/` and `/api/` already
    present in `apps/web/scripts/sw.template.js` (and generated `public/sw.js`).
  - Fix 3 (custom SW registration): `useFcmToken.ts` passes
    `serviceWorkerRegistration` (`/sw.js`) via the FID-based `register(m, {
vapidKey, serviceWorkerRegistration })` call — the `getToken` equivalent.
- Added docs only: `docs/issues/pwa-notifications.md` (issue record),
  `docs/known-limitations.md` (platform matrix + Linux PWA OS-permission setup
  - GNOME popup-content note), cross-links from `docs/push-notifications.md`.
    Fixes 4–5 are manual user actions; they are documented, not coded.
- I reviewed the diff before committing; verified with `npm run typecheck` and
  `npm run test:unit` (see below).

## 2026-10-14 — Socket handshake auth fallback (login loop on Cloud Run)

- Asked AI to diagnose a login-then-bounce-to-login loop on the GCP deploy.
- Diagnosis (verified with headers, curl, socket 101, and gcloud logs/traffic): the
  session cookie belongs to the web domain but the socket dials the API domain
  directly, so the handshake carried no cookie and was rejected as unauthorized.
- AI implemented: CSRF token in Socket.IO handshake `auth` (web), server-side
  `validateSessionByCsrf` fallback (cookie-first), plus `io.test.ts` covering
  cookie / handshake-token / wrong-token / anonymous cases.
- I reviewed the diff before deploying: auth stays cookie-first, the CSRF token
  is a per-session unguessable secret sent over TLS only, and real session expiry
  still logs the user out via the existing HTTP 401 path.
- 2026-10-17: AI assisted with the deployed-401 investigation + fixes (FCM
  stale-install reset-once retry in useFcmToken, logout-401 resilience and
  fetchMe race fix in AuthProvider, bfcache pagehide/pageshow socket
  handling). Verified with curl against the deployed Cloud Run endpoints
  (cookie attributes, /api/auth/me chain, served /manifest.webmanifest and
  bundled URLs) and the full local check suite (typecheck/tests/build/format).
