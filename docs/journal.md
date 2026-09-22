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

## 2026-09-20 — Image upload complete

### Built

**Backend**
- `POST /media/:kind` — multipart upload via multer
  - Magic-byte MIME detection (JPEG, PNG, GIF, WebP)
  - Size limit enforcement (10 MB images)
  - Row created `PENDING` → `COMPLETED`
  - Rollback on storage failure
- `GET /media/:id` — signed URL after participant check
  - Walks attachment → message → conversation → participants
  - Returns 403 for non-participants
  - Returns 400 if attachment is not yet attached to a message
- `toMessage()` generates signed GET URLs for each attachment
- `MEDIA_URL_TTL_SECONDS=900` in config

**Frontend**
- `useImageUpload.ts` — XHR upload with progress
- `ImagePicker.tsx` — file picker with local preview and progress bar
- `ImageMessage.tsx` — renders `attachment.url` in the bubble
- `ImageLightbox.tsx` — fullscreen viewer with ESC + click-outside
- `MessageComposer.tsx` — camera button
- `MessageBubble.tsx` — dispatches on `message.kind`
- `useSendMessage.ts` — accepts `SendInput` union (text, image, audio)

### Verified

**Backend (curl)**
- Valid JPEG → 201 with attachment id
- 11 MB file → 400 size rejected
- Text file named .jpg → 400 MIME rejected
- Unauthenticated upload → 401
- Fetch not-attached attachment → 400
- Fetch as non-participant → 403

**Frontend (two browsers)**
- Upload small JPEG → renders in chat as pending, then sent
- Upload PNG, WebP → render
- Refresh → image persists
- Bob (incognito) sees Alice's image in real time
- Click image → lightbox opens, ESC closes
- Oversized file → clear error message
- Wrong MIME → clear error message
- Multiple images in a row → all render, no duplicates
- Mobile viewport → layout intact

### Fixed
- `useImageUpload.ts` was missing the `/api` prefix → 404 on upload.
  Corrected to `POST /api/media/${kind}`.
- `ImagePicker` `onUploaded` signature — aligned to pass both
  `attachmentId` and `localPreviewUrl` so the optimistic bubble can
  render the local preview immediately.

### Notes
- Local uploads are near-instant (<300 ms for 2 MB).
- Upload approach is direct multipart (multer → server → storage.put),
  not signed PUT URLs. Simpler and already implemented.
- Signed URL TTL is 900 s. Regenerated on each message fetch.
- Local dev uses `fake-gcs-server` on port 4443.

### Next
- Voice messages: MediaRecorder, preview, playback
- Then merge `feature/media-images` to `main`


## 2026-09-22 — Voice messages complete

### Built
- `useVoiceRecorder.ts` — MediaRecorder wrapper with timer and cleanup
- `VoiceRecorder.tsx` — idle / recording / preview states
- `VoiceMessage.tsx` — playback with countdown timer and progress bar
- Wired into MessageComposer and MessageBubble

### Verified
- Record → preview → send works
- Countdown timer displays remaining time (was showing total before fix)
- Progress bar visible on both own and other bubbles
- Two users exchange voice messages in real time
- Mic denial → clear error message
- Cancel mid-recording → no message, stream released

### Fixed
- Timer was showing total duration, not remaining. Now tracks
  `currentMs` via `onTimeUpdate` and displays `remainingMs` while playing.
- Progress bar used `bg-white/20` on a white bubble — invisible.
  Now colors depend on `isOwn`.

### Notes
- MIME format: Chrome/Firefox → audio/webm; Safari → audio/mp4
- Backend already accepts both via magic-byte detection
- Max recording: 120s (enforced client + server)