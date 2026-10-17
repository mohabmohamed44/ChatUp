import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';

/**
 * The Firebase web-app config is inlined into the client bundle at build time
 * (NEXT_PUBLIC_* / Dockerfile build args). When a build arg is missing, the
 * compiled literals are EMPTY STRINGS — initializeApp still succeeds, but every
 * FCM request is then sent with no `x-goog-api-key` and fails with
 * 401 UNAUTHENTICATED ("missing required authentication credential") from
 * firebaseinstallations/fcmregistrations.googleapis.com. Detect that state
 * here: push is strictly best-effort, so one loud warning replaces a cascade
 * of doomed network calls.
 */
const requiredConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

function isFirebaseConfigValid(): boolean {
  return Object.values(requiredConfig).every((value) => typeof value === 'string' && value !== '');
}

export let firebaseApp: FirebaseApp | null = null;

if (isFirebaseConfigValid()) {
  const existing = getApps()[0];
  firebaseApp =
    existing ??
    initializeApp({
      apiKey: requiredConfig.apiKey,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: requiredConfig.projectId,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: requiredConfig.messagingSenderId,
      appId: requiredConfig.appId,
    });
} else if (typeof window !== 'undefined') {
  console.warn(
    '[push] Firebase config incomplete (missing NEXT_PUBLIC_FIREBASE_* build args). ' +
      'Push notifications are disabled. Known empty keys:',
    Object.entries(requiredConfig)
      .filter(([, value]) => !value)
      .map(([key]) => key),
  );
}

let messagingPromise: Promise<Messaging | null> | null = null;

/**
 * Returns the FCM Messaging instance, or null when running on the server,
 * when the browser lacks push prerequisites (service worker / Push API),
 * or when the build-time Firebase config is incomplete.
 * Awaiting it into a local gives call sites a clean `Messaging | null`
 * that narrows correctly — no more TS2345 on `Messaging | null`.
 */
export function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  // Snapshot to a const so the promise callback below narrows cleanly
  // (avoid the TS2345 narrowing loss on the mutable `let` export).
  const app = firebaseApp;
  if (!app) return Promise.resolve(null);
  if (!messagingPromise) {
    messagingPromise = isSupported()
      .then((supported) => (supported ? getMessaging(app) : null))
      .catch(() => null);
  }
  return messagingPromise;
}
