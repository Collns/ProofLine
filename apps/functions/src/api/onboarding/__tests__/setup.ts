import { initializeApp, getApps } from "firebase-admin/app";

// Initialize a dummy Firebase app before any test runs so that
// getFirestore() calls inside handlers don't throw "app/no-app".
if (getApps().length === 0) {
  initializeApp({ projectId: "test-project" });
}