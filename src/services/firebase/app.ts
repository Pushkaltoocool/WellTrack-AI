/**
 * Firebase (JS SDK, works in Expo Go). Config comes from EXPO_PUBLIC_* env vars, which are
 * public identifiers by design — access control lives in Firestore security rules.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth, type Auth } from 'firebase/auth';
import { initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/** False when the build has no Firebase config: accounts are hidden and the app stays local-only. */
export const FIREBASE_ENABLED = !!(config.apiKey && config.projectId && config.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function firebaseApp(): FirebaseApp {
  if (!FIREBASE_ENABLED) throw new Error('Accounts are not configured in this build.');
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function firebaseAuth(): Auth {
  if (!auth) {
    const a = firebaseApp();
    try {
      auth = initializeAuth(a, { persistence: getReactNativePersistence(AsyncStorage) });
    } catch {
      // Already initialised (e.g. after a Fast Refresh).
      auth = getAuth(a);
    }
  }
  return auth;
}

export function firestore(): Firestore {
  if (!db) {
    db = initializeFirestore(firebaseApp(), {
      localCache: memoryLocalCache(),
      experimentalAutoDetectLongPolling: true,
    });
  }
  return db;
}
