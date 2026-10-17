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
  vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
};

/**
 * Known placeholder / dummy values used in CI or local stubs. These pass a
 * non-empty check but will always 401 against fcmregistrations.googleapis.com.
 * Detected here so we disable push entirely instead of spamming 401 retries.
 */
const DUMMY_PATTERNS = [/^ci-dummy$/i, /^dummy$/i, /^placeholder$/i, /^test$/i, /^example$/i];

function isDummyValue(value: string): boolean {
  return DUMMY_PATTERNS.some((re) => re.test(value.trim()));
}

function isApiKeyPlausible(value: string): boolean {
  // Real Firebase Web API keys start with "AIza" and are ~39 chars.
  // Dummy values like "ci-dummy" must be rejected even though non-empty.
  if (isDummyValue(value)) return false;
  return value.startsWith('AIza') && value.length >= 20;
}

function isAppIdPlausible(value: string): boolean {
  if (isDummyValue(value)) return false;
  // Real appId: "1:123456789:web:abcdef..."
  return value.startsWith('1:') && value.includes(':web:');
}

function isGenericPlausible(value: string): boolean {
  if (!value || value.trim() === '') return false;
  if (isDummyValue(value)) return false;
  return true;
}

export function isFirebaseConfigValid(): boolean {
  return (
    typeof requiredConfig.apiKey === 'string' &&
    isApiKeyPlausible(requiredConfig.apiKey) &&
    typeof requiredConfig.appId === 'string' &&
    isAppIdPlausible(requiredConfig.appId) &&
    typeof requiredConfig.projectId === 'string' &&
    isGenericPlausible(requiredConfig.projectId) &&
    typeof requiredConfig.messagingSenderId === 'string' &&
    isGenericPlausible(requiredConfig.messagingSenderId) &&
    typeof requiredConfig.vapidKey === 'string' &&
    isGenericPlausible(requiredConfig.vapidKey)
  );
}

function getInvalidConfigReasons(): string[] {
  const reasons: string[] = [];
  if (!requiredConfig.apiKey || !isApiKeyPlausible(requiredConfig.apiKey)) {
    reasons.push(`apiKey="${requiredConfig.apiKey ?? ''}" (expected "AIza..." or missing)`);
  }
  if (!requiredConfig.appId || !isAppIdPlausible(requiredConfig.appId)) {
    reasons.push(`appId="${requiredConfig.appId ?? ''}" (expected "1:...:web:..." or missing)`);
  }
  if (!requiredConfig.projectId || !isGenericPlausible(requiredConfig.projectId)) {
    reasons.push(`projectId="${requiredConfig.projectId ?? ''}"`);
  }
  if (!requiredConfig.messagingSenderId || !isGenericPlausible(requiredConfig.messagingSenderId)) {
    reasons.push(`messagingSenderId="${requiredConfig.messagingSenderId ?? ''}"`);
  }
  const vapidKey = requiredConfig.vapidKey;
  if (!vapidKey || isDummyValue(vapidKey) || vapidKey.trim() === '') {
    reasons.push(`vapidKey="${vapidKey ?? ''}" (missing or dummy)`);
  }
  return reasons;
}

/**
 * Returns true if the error looks like a Firebase config/auth 401.
 * These must NOT trigger the stale-FID delete+retry path — they will 401
 * again and spam the console with fcmregistrations 401s.
 */
export function isFirebaseAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('fid-registration-failed') ||
    lower.includes('missing required authentication credential') ||
    lower.includes('expected oauth 2 access token') ||
    lower.includes('fcmregistrations.googleapis.com') ||
    lower.includes('401') ||
    lower.includes('unauthenticated') ||
    lower.includes('unauthorized')
  );
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
  const reasons = getInvalidConfigReasons();
  console.warn(
    '[push] Firebase config invalid — push notifications are disabled. ' +
      'This is expected in CI or when NEXT_PUBLIC_FIREBASE_* build args are missing/dummy. ' +
      'Fix: rebuild the web image with real Firebase build args (see apps/web/Dockerfile). ' +
      'Details:',
    reasons.length
      ? reasons
      : Object.entries(requiredConfig)
          .filter(([, v]) => !v)
          .map(([k]) => k),
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
