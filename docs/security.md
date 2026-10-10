# ChatUp Security Model

What protects what, where it is enforced, and what is explicitly _not_
claimed. Code references are `apps/server/src/…` unless noted.

## 1. Authentication

- **Registration/login** (`modules/auth/`): email + password, validated by
  shared Zod schemas (`packages/shared/src/auth/schemas.ts`). Passwords are
  hashed with **scrypt** (`auth.password.ts`) — never stored or logged in
  cleartext.
- **Sessions, not JWTs** (`modules/auth/auth.session.ts`): on login the
  server generates a 32-byte opaque token, stores only its **sha256 hash**
  (`Session.tokenHash`), and sends the raw token in an `HttpOnly` cookie
  (`chatup_session`). Lookup is by hash, so a database read alone never
  yields a usable session token. Sessions carry `expiresAt`
  (`SESSION_TTL_SECONDS`, default 30 days) and support revocation
  (`revokedAt`; logout revokes).
- **Socket auth** (`realtime/io.ts`): the handshake carries no token — the
  server parses the session cookie from the handshake headers and runs the
  same `validateSession`, so WS and HTTP share one identity source.
- **CSRF** (`modules/auth/auth.middleware.ts`): state-changing HTTP requests
  must send the `x-csrf-token` header matching the session's `csrfToken`
  (also set as a readable `chatup_csrf` cookie for the SPA). Cookie-only
  `GET`s (history, media, push-ack beacons) are session-authenticated without
  a CSRF check — safe methods, no mutations except the idempotent push-ack
  upsert (see §6).

## 2. Authorization (membership checks everywhere)

Every protected resource re-checks participation — ids are never trusted:

| Resource                               | Enforcement                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversations, messages, history       | `ConversationsService.requireMembership` before reads/writes                                                                                 |
| Socket rooms                           | Server joins sockets only to their own `user:<id>` and member `conversation:<id>` rooms; subscriptions can't be forged by guessing ids       |
| Sending                                | `senderId` comes from the session, never the payload — impersonation is structurally impossible                                              |
| Receipts (`delivered`/`read`/`played`) | Recorded against the authenticated user only; routes reject cross-user stamping                                                              |
| Media                                  | `POST /api/media/:kind` requires auth + ownership; `GET /api/media/:id` re-checks conversation membership before redirecting to a signed URL |
| User search                            | Returns only non-sensitive fields (no emails/hashes); see `modules/users/`                                                                   |

## 3. Input validation & output safety

- Shared Zod schemas (`packages/shared/src/…`) validate on **both** client
  (UX) and server (trust boundary): message length (`MESSAGE_MAX_LENGTH`
  4000, non-empty), conversation pagination bounds, auth field lengths.
- Bodies are capped (`express.json({ limit: '64kb' })`); uploads are capped
  per kind (images 5 MB, audio 10 MB) with server-side MIME/content checks,
  not filename trust.
- User content is rendered as text, never injected as HTML (XSS boundary is
  the React renderer + no `dangerouslySetInnerHTML` for message bodies).
- Errors use typed `AppError`s with safe messages; the 500 handler returns
  `internal_error` without leaking internals (`platform/http.ts`).

## 4. Transport & headers

- `helmet()` defaults, `x-powered-by` disabled, `trust proxy` only in
  production (correct `Secure` cookie + rate-limit IP handling behind a
  proxy).
- Cookies: `HttpOnly` session cookie, `SameSite=Lax`, `Secure` in production;
  CORS allowlist from `CORS_ORIGIN` with `credentials: true` (no wildcard).
- Global rate limit: 300 req/min/IP (`express-rate-limit`, draft-8 headers);
  auth endpoints should be tightened further before public exposure (see §7).
- Microphone/audio and push require secure context — deploy behind HTTPS
  (assessment deploys already do; `http://localhost` is the only exception).

## 5. Secrets & config

- All config is env-driven with Zod validation at boot
  (`platform/config.ts`) — the server refuses to start on bad config instead
  of running half-secured.
- `.env.example` contains placeholders only. FCM/GCS credentials resolve as:
  explicit key file → env credentials → Application Default Credentials, and
  never ship to the client. The service worker gets only _public_ Firebase
  config baked in at build time (`apps/web/scripts/generate-sw.mjs`).
- Session secret minimum length (16) is enforced by schema.

## 6. Logging & observability privacy

- HTTP logs redact `cookie`, `authorization`, and `set-cookie`
  (`platform/http.ts`, `platform/logger.ts`); CSRF tokens are redacted too.
- Never log: passwords, session tokens, FCM tokens (only a 12-char prefix at
  `info`), or message bodies. Push payloads log ids (`messageId`,
  `conversationId`), and notification previews travel only inside FCM.
- Health/readiness (`/healthz`, `/readyz`) and queue stats expose counts,
  not user data. Dead-letter inspection (`GET /api/queues/dead-letter`) is
  auth-gated.

## 7. Known gaps & next steps (honest list)

1. **No end-to-end encryption.** TLS + encrypted storage protect in transit
   and at rest, but the server sees plaintext. Do not claim E2EE.
2. **Push previews leave the system.** FCM bodies (sender name + 160-char
   preview) transit Google infrastructure by design — document this in any
   privacy statement; consider preview-less ("New message") pushes for
   sensitive deployments.
3. **Auth rate limits are coarse.** The global 300/min limiter is not a
   substitute for per-account login throttling + lockout; add before public
   launch (assessment scope documents the omission).
4. **No email verification / password reset.** Accounts areusable immediately;
   state this in user-facing docs.
5. **Signed media URLs are bearer tokens** for their TTL (default 15 min).
   Keep TTLs short and never log the URLs.
6. **Single signing secret.** `SESSION_SECRET` rotation revokes nothing
   granular — rotation plan: deploy dual-accept, then invalidate.
