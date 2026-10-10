# FCM Bug Tracing & Fix Guide (`chatUp` Monorepo)

This document provides a setup checklist, diagnostic commands, and updated source code to resolve FCM notification issues in `apps/server`.

---

## 1. Quick Terminal Diagnostic Commands

Run these commands from your project root (`/media/storage/Projects/chatUp`) to inspect your FCM configuration and trigger test execution.

### Step 1: Verify Key File Location & Permissions
Ensure `serviceAccountKey.json` is located in `apps/server/` and has valid permissions:

```bash
# Check if file exists in server directory
ls -la apps/server/serviceAccountKey.json

# Test JSON validity using node
node -e "console.log(require('./apps/server/serviceAccountKey.json').project_id)"
```

*(Output should print: `chatup-dev`)*

---

### Step 2: Test FCM Dispatch via Node Script

Run the test script directly from `apps/server`:

```bash
cd apps/server

# Execute test script directly using tsx/node
npx tsx scripts/test-fcm.ts
```

---

### Step 3: Check Active Server Process & Environment Variables

Check if your running backend process has `FCM_ENABLED=true` set:

```bash
# Check environment settings in apps/server/.env or runtime process
grep -E "FCM_ENABLED|FCM_PROJECT_ID" apps/server/.env
```

Required `.env` values:

```env
FCM_ENABLED=true
FCM_PROJECT_ID=chatup-dev
FCM_SERVICE_ACCOUNT_PATH=serviceAccountKey.json
```

---

## 2. Bugs Found & Fixed

### Bug 1: Missing `webpush` Configuration Block
**File:** `apps/server/src/platform/fcm.ts`

The multicast message payload lacked a `webpush.notification` block. Without it, desktop browser push notifications silently fail to display because the browser's Push API requires explicit web push notification configuration.

### Bug 2: Silent Credential Resolution Failures
**File:** `apps/server/src/platform/fcm.ts`

The `resolveCredential()` function had no logging. If the service account key was malformed or missing, failures were invisible — the function silently fell through to ADC which would then fail with an opaque error.

### Bug 3: No Per-Token Error Diagnostics
**File:** `apps/server/src/platform/fcm.ts`

When individual push deliveries failed in a multicast batch, the error details were discarded. Only aggregate counts were returned, making it impossible to diagnose why specific tokens failed.

### Bug 4: Inconsistent `SendPushInput` Interface Naming
**Files:** `apps/server/src/platform/fcm.ts`, `apps/server/src/platform/queue.ts`

The external API used `fids` as the field name which was confusing since the database column storing these values is `fcmToken`. Renamed to `tokens` in the public interface while keeping `fids` internally in the multicast payload for the Firebase Admin SDK v14.

---

## 3. Client Verification Checklist (`apps/web`)

If `sendPush` succeeds with `succeeded: 1` on the server but no pop-up banner appears in your browser:

1. **Service Worker Presence**: Ensure `apps/web/public/firebase-messaging-sw.js` is registered and serving correctly at `http://localhost:3000/firebase-messaging-sw.js`.
2. **Tab Focus State**: Browser push banners display natively **only when the web application tab is unfocused/in the background**. If the app tab is actively focused, notifications must be handled in foreground mode via `onMessage()` inside your React hooks (`useFcmToken.ts`).
