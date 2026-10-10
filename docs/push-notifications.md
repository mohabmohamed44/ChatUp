# ChatUp Push Notifications

End-to-end: server fan-out → FCM → browser. For FCM setup debugging see
[`fcm-debugging.md`](./fcm-debugging.md).

## 1. The three alert paths

A message can surface in three ways, all sharing
`alertIncomingMessage` (`apps/web/src/features/notifications/lib/alertIncomingMessage.ts`,
deduped by message id):

| Path               | When                                                                                    | How the sender shows                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **FCM background** | Recipient tab closed (or browser backgrounded)                                          | Service worker shows `رسالة من <senderName>` (from FCM data/`notification.title`)                                                          |
| **FCM foreground** | Tab open in foreground, `onMessage` fires                                               | In-app toast `رسالة من <senderName>: <preview>` (`apps/web/src/app/(app)/layout.tsx`)                                                      |
| **Socket alerts**  | Recipient online but tab hidden/unfocused (server skips FCM for online users by design) | Toast or SW notification titled `رسالة من <senderName>` (`useIncomingMessageAlerts.ts`; `senderName` rides on the `message:new` broadcast) |

If the user is looking at the conversation, no alert fires — the message just
renders inline. Own messages never alert.

## 2. Server fan-out (offline only)

`notifyWorker` in `apps/server/src/platform/queue.ts`:

1. Re-checks presence — recipients who reconnected while the job waited are
   suppressed (no redundant push + socket double-alert).
2. Collects live FCM installation ids (`Session.fid`, unrevoked/unexpired),
   deduped. No tokens → structured `skipped` log, not an error.
3. Looks up the sender's `displayName` and calls `fcm.sendPush` with:
   - `notification.title` = sender name, `notification.body` = 160-char preview,
   - `data` = `{ conversationId, messageId, senderId, senderName }`
     (all strings — FCM rejects anything else).
4. Prunes dead registrations (`registration-token-not-registered`, …) by
   nulling their `fid`, and logs `{ attempted, succeeded, failed }`.

`FcmService` (`apps/server/src/platform/fcm.ts`) resolves credentials as
key file → env → ADC, honors `FCM_ENABLED`/`FCM_DRY_RUN`, and sets webpush
icon/badge from `APP_URL` (absolute URLs required). Env:
`FCM_ENABLED, FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_PATH, APP_URL`
(`apps/server/src/platform/config.ts`).

## 3. Service worker (the part that broke, and why)

Template: `apps/web/scripts/sw.template.js`; generated (do not hand-edit):
`apps/web/public/sw.js`, built by `scripts/generate-sw.mjs` on `predev` /
`prebuild` because a worker can't read env files.

Rules that must hold (all true today):

- **The worker always calls `showNotification` inside
  `messaging.onBackgroundMessage`.** Unlike Android, browsers do _not_
  auto-display a `notification` payload — the old `if (!payload.notification)`
  guard meant real pushes showed nothing from this handler.
- **No raw `push` listener.** The Firebase SDK owns the `push` event; a
  second handler races it and parses the FCM envelope with the wrong field
  names (`payload.title` vs `payload.notification.title`), producing generic
  text. It was removed.
- **Sender-tolerant parsing:** `data.senderName || data.sender_name ||
notification.title`, same for the id. Notification `data` carries
  `{ conversationId, messageId, senderId, senderName }` for click routing.
- **Click** (`notificationclick`, registered first so the SDK doesn't swallow
  it): closes the notification, beacons `clicked`, and focuses/navigates to
  `/conversations/<id>`. Reads both plain `data` and the `FCM_MSG.data`
  wrapper.
- **Ack beacons**: `displayed` (fire-and-forget with `keepalive`) and
  `clicked` hit `GET /api/notifications/push-ack` — GET because a worker
  can't read the CSRF cookie; the session cookie still authenticates, and the
  upsert is idempotent (`PushAck @@unique([messageId, userId, status])`).

Note: Chrome/Firefox always print the origin (`localhost:3000`, your domain)
under the notification — that line is browser chrome, not the title. The
sender belongs in the title/body above it.

## 4. Client registration

`useFcmToken` (`apps/web/src/features/notifications/hooks/useFcmToken.ts`):

1. Registers `/sw.js`, waits for activation (10 s timeout with a loud error
   instead of hanging).
2. Registers with FCM (`vapidKey`, `onRegistered` → installation id) and
   uploads it as `fid` via `PATCH /auth/profile`. Rotation is handled by
   re-upload on change.
3. Permission is requested only from the "Enable notifications" banner click
   (iOS requires a user gesture); `denied`/`unsupported` states render
   guidance instead of re-prompting.

## 5. Debugging checklist

1. Server logs: `offline push sent` with `succeeded >= 1`? If `skippedReason:
disabled`, set `FCM_ENABLED=true`; if `no-tokens`, the recipient's `fid`
   never uploaded (check `PATCH /auth/profile` + permission state).
2. `FCM_DRY_RUN=true` validates without delivering — flip it off to actually
   receive.
3. Stale worker? DevTools → Application → Service Workers → Update/Unregister,
   then reload. `node --check public/sw.js` after template edits.
4. SW console (`chrome://inspect`, `about:debugging`) should log
   `الإشعار مبعوث من: <name> (ID: <id>)`. Empty name there = the sender's
   `displayName` is null in the DB, not a worker bug.
5. Two-tabs-open tests exercise the **socket** path, not FCM — that's
   expected (server skips FCM for online users). Close the recipient tab to
   test the worker path.
6. `GET /api/notifications/push-ack?messageId=…` rows (`PushAck` table) tell
   you whether notifications were displayed/clicked per user.
