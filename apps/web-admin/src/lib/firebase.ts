// PFL-111: client-side Firebase init for the admin dashboard.
//
// The admin dashboard reads live data straight from Firestore (companies,
// users, signed_messages, sessions) because there is no dedicated admin
// API yet. Config comes from VITE_FIREBASE_* env vars; projectId defaults
// to the known project so the dashboard at least targets the right DB even
// before the full web config is dropped into .env.local.
//
// SECURITY: these client reads are governed entirely by Firestore security
// rules. The collections involved (users, signed_messages, sessions)
// contain sensitive data — DO NOT ship open read rules to a real
// deployment. Scope rules to the demo project / authenticated admins
// before this is anything but a hackathon demo.
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

const FALLBACK_PROJECT_ID = 'proofline-cdabb';

function firebaseConfig() {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? FALLBACK_PROJECT_ID;
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket:
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
}

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;

function getFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  cachedApp = getApps()[0] ?? initializeApp(firebaseConfig());
  return cachedApp;
}

export function getDb(): Firestore {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getFirebaseApp());
  return cachedDb;
}

/** True when at least a web API key is configured (reads can authenticate). */
export function isFirebaseConfigured(): boolean {
  return typeof import.meta.env.VITE_FIREBASE_API_KEY === 'string'
    && import.meta.env.VITE_FIREBASE_API_KEY.length > 0;
}
