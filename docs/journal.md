# Development Journal

## 2026-09-16 — Phase 2 complete (auth end to end)

### Problems solved

**1. Prisma client runtime missing after v7 upgrade**

- Symptom: `Cannot find module '@prisma/client/runtime/library.js'`
- Cause: Prisma 7 changed the client output model and requires a driver adapter.
- Fix: Installed `@prisma/adapter-pg`, initialized `PrismaClient` with the adapter,
  set a custom output path in `schema.prisma`, and updated all imports to the
  generated path.
- Files: `apps/server/prisma/schema.prisma`, `apps/server/src/platform/db.ts`,
  `apps/server/prisma.config.ts`

**2. Session cookie removed in DevTools did not auto-redirect**

- Symptom: deleting the cookie left the user on a protected page until refresh.
- Cause: React state does not know the cookie disappeared. Nothing triggers a
  re-fetch until the next API call.
- Fix: added a global 401 handler. `apiFetch` dispatches `chatup:unauthorized`;
  `AuthProvider` listens, clears the user, and the protected layout redirects.
- Files: `apps/web/src/shared/lib/api.ts`,
  `apps/web/src/shared/providers/AuthProvider.tsx`

**3. Inline `tsx -e` with `!` broke in bash**

- Symptom: `bash: !user: event not found`
- Cause: bash treats `!` as history expansion.
- Fix: use single quotes around the inline script and double quotes inside it.

### Decisions made

- Chose React Context for auth state; deferred TanStack Query to Phase 3 for
  conversations and messages.
- Kept the feature-based folder structure for the frontend.
- Used shared Zod schemas in `packages/shared` so client and server validate
  with the same rules.

### Next

- Socket authentication middleware
- `conversation:subscribe` event
- Text messaging vertical slice

## 2026-09-17 — Socket authentication complete

### Verified

- Two users connect with distinct userIds
- 101 Switching Protocols handshake confirmed
- Session cookie sent with handshake (withCredentials)
- Logout disconnects socket and cancels reconnect
- 401 on /auth/me handled gracefully
- Added Auth Endpoints to Postman With Documentation and Example

### Discovered

- Backend messages module is fully implemented:
  - message:send, message:read, message:sync, message:new
  - Delivery receipts via markDelivered
  - Read receipts via markRead
  - History pagination and missed-message recovery
  - Conversation update broadcasts

### Next

- Build frontend chat UI (features/chat, features/conversations)
- Two-user real-time test


## 2026-09-18 — Phase 3 complete

### Built
- Chat UI (feature-based): `features/conversations/`, `features/chat/`
- Pages: `(app)/conversations/page.tsx`, `(app)/conversations/[id]/page.tsx`
- Socket client singleton wired into AuthProvider

### Test scripts
- `scripts/test-idempotency.ts` — same clientId twice, asserts one row
- `scripts/seed-messages.ts` — seeds N messages via socket

### Verified
- Two-user browser test: Alice + Bob in two windows, real-time exchange — PASS
- Idempotency: same clientId → same message id, one DB row — PASS
- Delivery + read receipts: status icons update live — PASS
- Typing indicators: shown between participants — PASS
- Presence: online/offline dot in header — PASS
- Unread counts: increment on new, clear on open — PASS
- Pagination: 51 messages loaded as 30 + 21, no gaps — PASS
- Reconnect sync: `message:sync` recovered missed messages — PASS

### Fixed
- **Pagination cursor was a UUID.** `id: { lt: BigInt(before) }` compared a UUID column to a number, returning nothing.
  - `id` → `sequence` in the where clause
  - `nextCursor: last.id` → `last.sequence.toString()`
  - Schema: `before: z.uuid()` → `z.string().regex(/^\d+$/)`
  - Verified: 51 messages loaded cleanly across two pages

### Closed
- **Self-receipts** — not reproducible. Re-seeded 40 messages, diagnostic query returned 0 receipts. Earlier observation was likely a stale dev server.

### Discovered
- Prisma 7 moved seed config from `package.json` to `prisma.config.ts`
- Seed command is now `migrations.seed: 'tsx prisma/seed.ts'`

### Coverage vs. brief
- Section 7 — Conversations and history ✅
- Section 8 — Real-time messaging ✅
- Section 9 — Text messages ✅
- Section 12 — Presence, typing, status ✅
- Section 13 — Data model and API ✅ (written API docs deferred to Phase 5)

### Next
- Phase 4: image upload and voice messages