// Firebase client config for web-sign.
//
// The Firebase web apiKey is NOT a secret — it's a public project
// identifier that's safe to ship in the bundle (Google's docs:
// firebase.google.com/docs/projects/api-keys). Access control happens via
// Firebase Auth, Firestore rules, and App Check, not the apiKey.
//
// Values come from VITE_FIREBASE_* env vars (set in apps/web-sign/.env or
// the build environment); the defaults below match the proofline-cdabb
// project so a fresh dev checkout works without manual env setup.

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
}

function readConfig(): FirebaseConfig {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  return {
    apiKey:     env.VITE_FIREBASE_API_KEY     ?? 'AIzaSyAExampleApiKeyReplaceAtDeploy',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? 'proofline-cdabb.firebaseapp.com',
    projectId:  env.VITE_FIREBASE_PROJECT_ID  ?? 'proofline-cdabb',
    appId:      env.VITE_FIREBASE_APP_ID,
  };
}

let cachedApp: FirebaseApp | null = null;
function ensureApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  const existing = getApps()[0];
  cachedApp = existing ?? initializeApp(readConfig());
  return cachedApp;
}

export function getFirebaseAuth(): Auth {
  return getAuth(ensureApp());
}
