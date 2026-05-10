// Types and interfaces
export * from './types.js';

// Challenge store implementation
export { InMemoryChallengeStore } from './challenges.js';

// Server-side ceremony helpers
export {
  startRegistration,
  finishRegistration,
  startAssertion,
  finishAssertion,
} from './server.js';
export type {
  StartRegistrationInput,
  FinishRegistrationInput,
  FinishRegistrationResult,
  FinishRegistrationFailureReason,
  StartAssertionInput,
  FinishAssertionInput,
  FinishAssertionResult,
  FinishAssertionFailureReason,
} from './server.js';

// Note: browser.ts (startRegistrationCeremony, startAssertionCeremony) is NOT exported here.
// Import directly: import { startRegistrationCeremony } from '@proofline/webauthn/src/browser.js'
// It calls navigator.credentials and will not work in server/Node.js contexts.
