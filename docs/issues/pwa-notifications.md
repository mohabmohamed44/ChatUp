# Issue: PWA Push Notifications Not Displaying Correctly

**Status:** Open
**Severity:** Medium (functional, not blocking)
**Affects:** Installed PWA on Linux; mobile foreground behavior; iOS (unsupported in Safari tabs)
**Reporter:** Mohab
**Assignee:** AI Agent
**Created:** 2026-10-15

---

## 1. Problem Statement

When the ChatUp web app is installed as a PWA, incoming push notifications do not display as OS-level notifications in several scenarios:

1. **Linux (installed PWA):** Notifications work when the app is opened in a regular Chrome tab, but do not appear at all when the app is installed as a PWA and minimized.
2. **Android (installed PWA):** Notifications appear as in-app banners instead of OS-level notifications when the app is in the foreground.
3. **iOS (Safari tab):** No notifications appear — expected, since iOS only supports push for PWAs installed to the Home Screen (iOS 16.4+).

Non-PWA browser tabs (Chrome on desktop) work correctly in all cases.

---

## 2. Impact

- Users who install the PWA on desktop stop receiving notifications when the app is minimized.
- Mobile users perceive notifications as "missing" because the OS notification tray is empty when the app is in the foreground.
- Demo/assessment risk: a reviewer installing the PWA and receiving no notification may conclude the feature is broken.

---

## 3. Environment

| Platform                                           | Reproducible? | Notes                              |
| -------------------------------------------------- | ------------- | ---------------------------------- |
| Linux desktop + Chrome installed PWA               | ✅ Yes        | No notification when minimized     |
| Linux desktop + Chrome tab                         | ❌ No (works) | Browser-level notification appears |
| Android + Chrome installed PWA (foreground)        | ✅ Yes        | Shows in-app, not OS tray          |
| Android + Chrome installed PWA (background/closed) | ❌ No (works) | OS notification appears            |
| iOS Safari tab                                     | N/A           | Push unsupported in tabs           |
| iOS installed to Home Screen (16.4+)               | ❌ No (works) | OS notification appears            |

---

## 4. Root Cause Analysis

### 4.1 Two separate notification permission systems

Chrome tabs and installed PWAs use **different permission scopes**:

- Browser-level permission (Chrome settings) governs tabs
- OS-level permission (system notification settings) governs installed PWAs

Granting notification permission in a Chrome tab **does not** grant it to the installed PWA. The OS treats the PWA as a distinct application.

**Verified:** Linux notification settings show no `ChatUp` entry, or it exists but is muted.

### 4.2 Foreground handler never shows OS notifications

Current `useFcmToken.ts` foreground handler:

```typescript
onMessage(messaging, (payload) => {
  toast.show({ title, body }); // in-app only
});
```

Firebase's `onMessage` fires when the app is **focused**. Installed PWAs on Linux **report as focused even when minimized** — a known Chrome-on-Linux quirk. As a result:

- `onMessage` fires instead of `onBackgroundMessage`
- The handler shows only an in-app toast
- No OS notification is emitted

The same code path causes the Android foreground issue: when the PWA is focused, the OS tray stays empty by design.

### 4.3 The `sw.js` fetch handler may intercept FCM traffic

If the service worker's fetch handler intercepts `/api/` or Firebase API calls, FCM delivery can be affected. Verify the early-return guard is present.

### 4.4 iOS Web Push requires Home Screen install

Per Apple's Web Push specification, iOS Safari (16.4+) only supports push notifications for PWAs **installed to the Home Screen**. Push in a Safari tab is not supported.

---

## 5. Required Fixes

### Fix 1 — Update `onMessage` to show OS notifications when app is not visible

**File:** `apps/web/src/features/notifications/useFcmToken.ts`

**Current code:**

```typescript
onMessage(messaging, (payload) => {
  toast.show({
    title: payload.notification?.title,
    body: payload.notification?.body,
  });
});
```

**Replace with:**

```typescript
onMessage(messaging, async (payload) => {
  const title = payload.notification?.title ?? 'New message';
  const body = payload.notification?.body ?? '';
  const conversationId = payload.data?.conversationId;

  // If the PWA window is not visible (minimized, backgrounded, screen locked),
  // show an OS-level notification. Otherwise, do nothing — Socket.IO already
  // rendered the message in the app UI.
  if (document.visibilityState !== 'visible') {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      icon: '/icons/192.png',
      badge: '/icons/192.png',
      tag: `conv-${conversationId}`, // replaces duplicates, doesn't stack
      data: { conversationId },
    });
  }
});
```

**Why this works:** `document.visibilityState === 'hidden'` when:

- The PWA window is minimized
- Another window covers it completely
- The screen is locked
- The user switched to another virtual desktop

This forces an OS notification path even when Firebase's "foreground" heuristic is wrong.

---

### Fix 2 — Verify `sw.js` does not intercept FCM or API traffic

**File:** `apps/web/public/sw.js`

**Verify this early return exists:**

```javascript
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CRITICAL: never intercept Socket.IO or API calls
  if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline')));
  }
});
```

**If missing**, add it. Intercepting these paths breaks both realtime messaging and FCM.

---

### Fix 3 — Verify `getToken()` passes the custom service worker

**File:** `apps/web/src/features/notifications/useFcmToken.ts`

Firebase's `getToken()` defaults to `/firebase-messaging-sw.js` unless told otherwise. Since ChatUp uses `/sw.js`, the registration must be passed explicitly:

```typescript
const registration = await navigator.serviceWorker.register('/sw.js');

const token = await getToken(messaging, {
  vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
  serviceWorkerRegistration: registration, // ← REQUIRED
});
```

**Verify with:**

```bash
grep -n "serviceWorkerRegistration" apps/web/src/features/notifications/useFcmToken.ts
```

If empty, add the parameter.

---

### Fix 4 — Grant OS-level notification permission to the Linux PWA

**Manual step (user-facing, not code):**

1. Open the installed ChatUp PWA
2. Right-click the window title bar → **Open DevTools** (or press `Ctrl+Shift+I`)
3. Console → run:
   ```javascript
   new Notification('Test', { body: 'OS permission check' });
   ```
4. If no notification appears, open **System Settings → Notifications** and enable ChatUp
5. If ChatUp is not listed, uninstall the PWA (`chrome://apps` → right-click → Remove) and reinstall; grant the OS permission when prompted

**This step is documented in the README as a user setup note.**

---

### Fix 5 — Enable "Show Message Content in Popups" on Linux

**Manual step (user-facing):**

Linux notification settings (GNOME) default this to **off** for some applications. If enabled notifications appear without body text:

**Settings → Notifications → ChatUp → Show Message Content in Popups → ON**

Document this in the README as a known user-configurable setting.

---

## 6. Platform Behavior Reference

| Platform            | Foreground (app focused)          | Background (minimized/closed) | Home Screen Install Required           |
| ------------------- | --------------------------------- | ----------------------------- | -------------------------------------- |
| Linux Chrome tab    | Browser notification              | Browser notification          | No                                     |
| Linux Chrome PWA    | **OS notification** (after Fix 1) | OS notification               | No (but separate OS permission needed) |
| Android Chrome PWA  | **OS notification** (after Fix 1) | OS notification               | No                                     |
| iOS Safari tab      | N/A                               | N/A                           | **Yes (16.4+)**                        |
| iOS Home Screen PWA | **OS notification** (after Fix 1) | OS notification               | Yes                                    |

**Documented limitation:** iOS Safari tabs cannot receive push notifications at all. This is an Apple platform restriction, not a ChatUp bug.

---

## 7. Acceptance Criteria

The issue is considered fixed when all of the following pass:

### Linux

- [ ] Installed PWA minimized → incoming message → OS notification appears
- [ ] Installed PWA focused → incoming message → in-app bubble appears, **no** OS notification (correct suppression)
- [ ] Chrome tab focused → incoming message → browser notification appears
- [ ] Chrome tab minimized → incoming message → browser notification appears

### Android

- [ ] Installed PWA focused → incoming message → OS notification appears
- [ ] Installed PWA backgrounded → incoming message → OS notification appears
- [ ] Installing PWA triggers OS notification permission prompt

### iOS

- [ ] PWA installed to Home Screen → notification permission granted → OS notification appears when backgrounded
- [ ] README documents that Safari tabs do not support push

### Documentation

- [ ] `docs/known-limitations.md` updated with platform matrix
- [ ] `README.md` includes PWA install instructions and OS permission setup
- [ ] `AI_USAGE.md` documents the `visibilityState` fix

---

## 8. Verification Steps

**Run these after applying all code fixes and redeploying:**

### 8.1 Verify build has the fix

```bash
# Check the deployed web bundle contains the visibilityState check
curl -s https://chatup-web-600949300942.europe-west1.run.app/_next/static/chunks/*.js 2>/dev/null \
  | grep -o "visibilityState" | head -1
```

Expected: `visibilityState` appears (at least once).

### 8.2 Verify service worker has no conflict

```bash
# Deployed sw.js must NOT have a manual push listener
curl -s https://chatup-web-600949300942.europe-west1.run.app/sw.js | grep -c "addEventListener('push'"
```

Expected: `0` (Firebase SDK handles push internally; a manual listener would conflict).

### 8.3 Verify `getToken` passes the custom SW

```bash
grep -n "serviceWorkerRegistration" apps/web/src/features/notifications/useFcmToken.ts
```

Expected: one match.

### 8.4 End-to-end test

1. Install ChatUp as PWA on Linux
2. Grant OS notification permission when prompted
3. Log in as `alice@chatup.dev`
4. Minimize the PWA window
5. From a second browser, log in as `bob@chatup.dev` and send a message
6. **Assert:** OS notification appears in the Linux tray within 3 seconds
7. Click the notification → ChatUp window focuses with the correct conversation open

Repeat the same test with:

- PWA focused (assert in-app toast only, no OS banner)
- Android PWA (foreground + background)
- iOS Home Screen PWA (foreground + background)

---

## 9. Non-Goals

- **Do not** add a manual `push` listener to `sw.js`. Firebase's SDK registers its own handler; two listeners cause duplicate notifications.
- **Do not** switch from `sw.js` to `firebase-messaging-sw.js` unless the Firebase default path is required. The custom SW is intentional to share caching logic.
- **Do not** attempt to make iOS Safari tabs support push. Apple's Web Push requires Home Screen install — this is not negotiable.

---

## 10. Agent Task Checklist

```
[ ] Read apps/web/src/features/notifications/useFcmToken.ts
[ ] Replace onMessage handler with visibilityState-aware version (Fix 1)
[ ] Verify sw.js has early return for /api/ and /socket.io/ (Fix 2)
[ ] Verify getToken() passes serviceWorkerRegistration (Fix 3)
[ ] Run typecheck: npm run typecheck
[ ] Run unit tests: npm run test:unit
[ ] Push to main → wait for CD green
[ ] Manual verify on Linux installed PWA
[ ] Manual verify on Linux Chrome tab
[ ] Manual verify on Android (if available)
[ ] Update docs/known-limitations.md with platform matrix
[ ] Update README.md with PWA install + OS permission notes
[ ] Update AI_USAGE.md with the fix entry
[ ] Close issue with a comment listing what was changed and verified
```

---

## 11. References

- Firebase Cloud Messaging Web — onMessage / onBackgroundMessage lifecycle
- MDN: Page Visibility API (`document.visibilityState`)
- Apple Web Push: iOS 16.4+ requires Home Screen install
- Chrome: Installed PWAs are distinct notification sources from tabs
- GNOME: `org.gnome.desktop.notifications` application-level permissions
- BullMQ/Cloud Run incompatibility with repeatable jobs (adjacent issue, tracked separately)

---

## 12. Commit Message Template

```
fix(notifications): show OS notification when PWA is not visible

- Replace onMessage toast-only handler with visibilityState-aware version
- Show OS notification when document.visibilityState !== 'visible'
- Suppress OS notification when app is genuinely focused (Socket.IO path)
- Add tag to dedupe rapid-fire notifications per conversation
- Document platform behavior matrix in docs/known-limitations.md
- Update README with PWA install + OS permission setup

Verified:
- Linux PWA minimized → OS notification appears
- Linux PWA focused → in-app only, no OS banner
- Android PWA backgrounded → OS notification appears
- iOS Home Screen PWA → OS notification appears

Fixes #<issue-number>
```
