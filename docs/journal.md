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

**3. Inline** `tsx -e` **with** `!` **broke in bash**

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



## 2026-09-26 — Read more, clickable links, network banner



### Built

**Read more button**

- `apps/web/src/shared/lib/text.ts` — truncation helpers
- `apps/web/src/features/chat/components/MessageBody.tsx` — new component
- Truncates messages over 300 characters at a word boundary
- "Read more" / "Show less" toggle
- Uses `Intl.Segmenter` for grapheme-safe truncation (emoji, Arabic combining marks)
- Never cuts inside a URL — backs off to before the link starts

**Clickable links**

- `linkify-it` for URL detection
- Only http/https become clickable. `javascript:`, `data:`, `file:`, `ftp:`, `mailto:`, protocol-relative URLs are rejected
- All links open in a new tab with `target="_blank"` and `rel="noopener noreferrer nofollow"`
- Long URLs wrap with `break-all`, do not break the layout
- `segmentText()` re-checks the scheme as defense in depth

**BiDi text rendering**

- `analyzeDirection()` returns base direction from the first strong character
- `hasMixed` flag detects Arabic + Latin in the same message
- `<bdi>` wrapper around mixed content for character-level isolation
- `unicode-bidi: isolate` on the message paragraph
- Wrapped in `<p dir="rtl|ltr|auto">` so each message picks its own direction

**Font stack**

- Installed `@fontsource/inter` and `@fontsource/noto-sans-arabic`
- Added `.font-message` class with fallback chain: Inter → Noto Sans Arabic → system fonts
- Prevents Latin glyphs from being substituted with Arabic lookalikes

**Network status banner**

- `apps/web/src/features/chat/hooks/useNetworkStatus.ts` — combines `navigator.onLine` with socket state
- `apps/web/src/features/chat/components/ConnectionBanner.tsx` — red for offline, amber for reconnecting
- Debounced 1.5s to avoid flicker on brief drops
- Accessible: `role="status"`, `aria-live="polite"`
- Sliding animation: `max-height` transition for smooth show/hide
- Mounted in `apps/web/src/app/(app)/layout.tsx`

**Layout polish**

- Spinner-based loading state on auth check
- Semantic `<main>` element for the content area
- `bg-slate-50` background for the app shell



### Fixed

- `linkify-it` **import** — was `import { LinkifyIt }` (named), should be `import LinkifyIt` (default). Named import was `undefined` at runtime.
- **Scheme removal** — `linkify.add('ftp:', null)` adds with a null definition instead of removing. Correct call is `linkify.add('ftp:')` with no second argument.
- `ARABIC_RE` **escapes** — regex was corrupted with literal Arabic characters instead of `\uXXXX` escape sequences. Restored proper escapes for Hebrew, Arabic, Persian, Urdu ranges.
- **Fuzzy email and IP detection** — disabled `fuzzyEmail` and `fuzzyIP` to prevent false positives (`user@example.com`, `192.168.1.1`).



### Verified

**Read more**

- Short messages (< 300 chars) → no button
- Exactly 300 chars → no button
- 301+ chars → button appears, toggles correctly
- Long URL at the cut point → truncates before the link, not inside it
- Arabic, mixed Arabic/English, emoji-heavy messages all truncate cleanly
- Own vs other bubbles → correct button color
- Multiple long messages → independent expand state

**Clickable links**

- `https://example.com` → clickable, opens in new tab
- `www.example.com` → clickable, becomes `http://www.example.com`
- `javascript:alert(1)` → NOT clickable
- `data:text/html,...` → NOT clickable
- `ftp://example.com` → NOT clickable
- `mailto:user@example.com` → NOT clickable
- `//evil.com` → NOT clickable
- Trailing punctuation (`.`, `,`, `)`) excluded from link
- Multiple URLs in one message → all clickable
- URLs inside Arabic text → correct direction, correct glyphs

**Network banner**

- DevTools → Offline → red banner appears "No internet connection"
- Stop backend → amber banner appears "Reconnecting…"
- Restart backend → banner auto-hides on reconnect
- Restore connection → banner disappears immediately
- Debounce works: brief drops (< 1.5s) do not flash the banner

**BiDi text**

- Arabic-only messages render RTL
- English-only messages render LTR
- Mixed Arabic + Latin: each script renders with correct direction and glyphs
- Numbers and emoji are neutral, do not affect base direction



### Known limitations

- Rich link previews (WhatsApp-style cards) not implemented. Would need a backend endpoint with SSRF protection.
- Bare emails like `user@example.com` are not clickable (fuzzyEmail disabled by design).
- Bare IP addresses like `192.168.1.1` are not clickable (fuzzyIP disabled).
- Multi-line BiDi is handled per paragraph, but very complex mixed content could still have edge cases.



### Notes

- `linkify-it` is what Slack and Discord use. Well-tested and maintained.
- Truncation uses `Intl.Segmenter` for grapheme clustering. Supported in all modern browsers.
- The banner debounce is 1.5 seconds. Brief WiFi blips will not show the banner.
- The `dir` attribute is computed per message, not per app. Arabic users can still see English messages with correct LTR rendering.



### Next

- Voice draft persistence (from Eng. Mohammed's list)
- Message editing with `editedAt` column and `message:edit` socket event
- Local cache with IndexedDB for messages and conversations
- PWA + FCM for push notifications
- Message queues for async work (only when needed)



## 2026-09-28 — Design documentation



### Built

**Conceptual ERD (Chen notation)**

- 7 entities as rectangles: User, Session, Conversation, ConversationParticipant, Message, MessageReceipt, MediaAttachment
- Attributes as ellipses, with primary keys underlined
- Composite primary keys on ConversationParticipant and MessageReceipt
- Relationships as diamonds with cardinality on the edges
- 11 relationships total, all marked with cardinality
- Uses draw.io (source + PDF export)

**Physical ERD (relational schema)**

- Same 7 entities, but showing actual columns and types
- UUID primary keys, foreign keys marked, unique constraints marked
- Indexes and composite keys documented
- Uses `erDiagram` syntax + draw.io

**System Architecture (three tiers)**

- Client tier: Browser, React UI, AuthProvider, Socket.IO Client, HTTP client
- Application tier: Express API, Socket.IO Server, Auth Middleware, Feature Modules, Platform Layer
- Data tier: PostgreSQL, Redis, Object Storage
- Two protocols labeled: HTTPS for REST, WSS for realtime
- Color-coded by tier (blue / yellow / green)

**Modular Monolith diagram**

- Shows three packages: apps/web, apps/server, packages/shared
- Feature modules listed: auth, conversations, messages, media, presence, users
- Platform layer: config, db, storage, logger, http, errors
- Dependency arrows: solid for runtime, dashed for compile-time imports
- Rule: dependencies point inward only

**GCP Deployment Topology**

- HTTPS Load Balancer with managed SSL
- Cloud CDN for frontend static assets
- Compute Engine e2-small VM for backend
- Cloud SQL for PostgreSQL
- Memorystore for Redis
- Cloud Storage for media
- Artifact Registry, Secret Manager, Cloud Logging

**Docker Compose architecture**

- Local dev: postgres, redis, fake-gcs (infra only)
- Full stack: infra + api + web containers
- Service names and ports labeled
- One network, service-name DNS



### Fixed

- `Auth (Argon2)` → `Auth (scrypt)` in the architecture diagrams.
The code uses scrypt (N=16384, r=8, p=1), not Argon2.
- Cardinality labels on `Message ↔ MediaAttachment` (0..1 : 1) and
`Message ↔ ConversationParticipant` (Many : 0..1) corrected.



### Verified

- Every entity in the conceptual ERD matches `schema.prisma`
- All 11 relationships present with correct cardinality
- Primary keys underlined; composite keys marked
- 3-tier architecture matches the actual code folders
- Modular monolith structure matches `apps/` and `packages/` layout
- GCP topology uses only services in the planned deployment



### Notes

- Diagrams stored in `docs/diagrams/` with both `.drawio` sources and `.png` exports
- Eraser.io used to generate the initial drafts, then refined in draw.io
- PDFs merged into a single file for delivery to Mr. Mohammed
- Source files committed so the diagrams can be edited later



### Next

- Voice draft persistence
- Message editing with editedAt column and message:edit event
- Local cache with IndexedDB
- PWA + FCM



## 2026-09-30 — Transactions, RTL, timestamps, Docker



### Fixed

**Database transactions**

- `auth.register` — user + session creation now atomic
- `media upload` — attachment create + storageKey update atomic
- `messages.send` — insert, conversation pointer, receipts atomic
- `messages.markDelivered` — receipt upserts in one transaction with a
shared timestamp
- `messages.markRead` — read markers and participant pointer atomic
- Idempotency: replaced find-then-create with try/catch on P2002.
Concurrent retries with the same clientId now resolve to the winner
row instead of racing.

**Presence grace period**

- `LIMITS.PRESENCE_GRACE_MS`: 30_000 → 3_000
- Offline updates now reach partners in real time instead of requiring
a page refresh. 3s rides out a page refresh but still delivers
offline for genuine disconnects.

**Docker**

- Docker Desktop context override caused `docker` CLI to look at
`~/.docker/desktop/docker.sock` instead of `/var/run/docker.sock`.
Switched back to `default` context.
- Zombie `docker-pr` processes held ports 5432, 6379, and 4443 after
daemon restarts. Freed with `fuser -k`.



### Added

**RTL support (apps/web)**

- `LocaleProvider` sets `dir` and `lang` on `<html>`
- Language toggle in the conversation list header
- Physical CSS replaced with logical properties across components
(`left-` → `start-`, `pl-` → `ps-`, etc.)
- Directional icons rotate with `rtl:rotate-180` (ArrowLeft, SendHorizontal)
- Placeholder alignment follows UI direction

**Timestamp formatting**

- Single source of truth in `apps/web/src/shared/lib/format.ts`
- Three functions: `formatListTimestamp`, `formatBubbleTimestamp`,
`formatFullTimestamp`
- List: Now → 5m → 10:35 AM → Yesterday → Mon → Sep 24
- Bubble: 10:35 AM → Yesterday 10:35 AM → Mon 10:35 AM → Sep 24
- Full: Thursday, September 24, 2026 at 10:35 AM
- Arabic localization via `Intl` with `ar-EG-u-nu-latn` (Western digits)
- Formatters cached per locale to avoid re-construction on render
- `formatMessageTime` kept as backwards-compatible alias



### Verified

- Register a new user → exactly 1 session created
- Rollback test: forced throw inside transaction → no user row written
- RTL toggle flips sidebar, icons, bubbles, placeholders correctly
- Alice closes tab → Bob sees Offline in ~3s (no refresh)
- Alice refreshes → Bob does not see a flicker
- Timestamps show correct labels in both English and Arabic



### Next

- Voice draft persistence
- Message editing



## 2026-10-01 — Voice draft persistence



### Added

`apps/web/src/shared/lib/drafts.ts` (new)

- IndexedDB wrapper using the `idb` package
- Database: `chatup-drafts`
- Object store: `voiceDrafts`
- Key: `conversationId` (one draft per conversation)
- Value shape:

```
{
  conversationId: string,
  blob: Blob,
  mimeType: string,
  durationMs: number,
  createdAt: number
}
```

- Public functions:
- `saveVoiceDraft(conversationId, blob, mimeType, durationMs)`
- `getVoiceDraft(conversationId)`
- `clearVoiceDraft(conversationId)`
- `listVoiceDrafts()`
- `pruneOldDrafts()` — removes drafts older than 24 hours



### Wired

- `useVoiceRecorder.ts` now calls `saveVoiceDraft` inside `recorder.onstop`,
after the blob is created and before the preview state is set. The call
is fire-and-forget with a `.catch()` so a storage failure never blocks
the recording UI.
- `VoiceRecorder.tsx` calls `clearVoiceDraft(conversationId)` on send and
on discard.



### Why IndexedDB

- `localStorage` cannot store Blobs or binary data
- `localStorage` is synchronous and blocks the main thread
- IndexedDB persists across tab close and browser restart
- IndexedDB has a larger quota (typically 50% of free disk)
- One draft per conversation, keyed by `conversationId`



### Verified

- Record → Stop writes exactly one row to `chatup-drafts` → `voiceDrafts`
- The row contains a non-empty Blob, the correct mimeType, durationMs,
and a recent createdAt
- Sending the message clears the row
- Discarding clears the row
- Closing the tab preserves the row
- Two conversations produce two independent rows
- Incognito and normal tabs have separate IndexedDB storage; drafts do
not leak between them
- Drafts older than 24 hours are removed on the next app load
- If IndexedDB is unavailable (e.g., some private modes), the save fails
silently and the recording still works



### Notes

- Blob is stored as-is, no base64 encoding
- Storage is per browser context, not per user account
- The feature is client-only; no backend or schema changes



### Next

- Message editing
- Local cache for messages and conversations

## 2026-10-03 — Concurrency verification, copy message, DB pointer fix

### Concurrency verification

Ran `apps/server/scripts/test-concurrent-sends.ts` with 50 parallel sends
against the local stack.

Results:
- Sent: 50, OK: 50, Failed: 0
- Total time: 949ms (19ms average per message)
- Rows in DB: 50
- Unique bodies: 50, Unique clientIds: 50

Verdict: PASS. Confirms the transaction and idempotency work from
2026-09-30 hold under concurrency. This is a correctness test, not a
performance test — the full 100-user load test runs after Phase 6
deployment.

Script reads credentials from `.env`:
- `SEED_USER_EMAIL`
- `SEED_USER_PASSWORD`
- `API_URL`

Placeholders added to `.env.example`.

### Copy message button

Added in `apps/web/src/features/chat/components/MessageBubble.tsx`.

- Copy icon appears on hover next to the timestamp
- Uses `navigator.clipboard.writeText` with `execCommand` fallback
- Icon becomes a checkmark for 1.5 seconds to confirm
- Only shown for text messages with a non-empty body
- Keyboard accessible (focus-visible) and screen-reader friendly
  (`aria-label="Copy message"`)
- Colors match the bubble: light on own, slate on other
- `title` attribute removed to prevent the native tooltip from
  overlaying the timestamp

Verified: copy works on own and other messages, preserves newlines,
emoji, and mixed Arabic/English text. No copy icon on image or voice
messages.

### Conversation list pointer fix

**Problem:** Conversation `90bc4b06-...` had 44 messages in the DB but
`lastMessageId` was NULL, so the list showed "No messages yet" even
after a refresh.

**Root cause:** A previous SQL cleanup nulled `lastMessageId` for
messages matching a test pattern and did not re-populate it from the
newest remaining message. The application code was correct — the bug
was in the DB state.

**Fix:**
- Repair SQL repopulated `lastMessageId` and `lastActivityAt` from the
  newest message per conversation
- Added a defensive fallback in `loadRowsForUser()` in
  `conversations.service.ts` — if `row.lastMessage` is null but
  messages exist, it fetches the latest one before returning. The extra
  query runs only for affected rows.

**Verified:**
- Fallback proven by temporarily re-nulling the pointer; the API still
  returned the correct preview
- `send()` updates the pointer on every message (verified with a
  test send)
- All 3 conversation rows now have a non-null `lastMessageId`
- `npx tsc --noEmit` passes

### Next
- Message editing (schema + socket event + inline edit UI)
- Local cache for messages and conversations
- 100-user load test (after Phase 6 deployment)