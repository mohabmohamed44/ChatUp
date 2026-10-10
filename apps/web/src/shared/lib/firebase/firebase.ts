import { initializeApp, type FirebaseApp } from "firebase/app";
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

export const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);

let messagingPromise: Promise<Messaging | null> | null = null;

/**
 * Returns the FCM Messaging instance, or null when running on the server
 * or when the browser lacks push prerequisites (service worker / Push API).
 * Awaiting it into a local gives call sites a clean `Messaging | null`
 * that narrows correctly — no more TS2345 on `Messaging | null`.
 */
export function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (!messagingPromise) {
    messagingPromise = isSupported()
      .then((supported) => (supported ? getMessaging(firebaseApp) : null))
      .catch(() => null);
  }
  return messagingPromise;
}
