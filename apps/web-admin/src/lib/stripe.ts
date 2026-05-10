// Loads Stripe.js for the Officer Identity step. Stripe Identity uses
// stripe.verifyIdentity(clientSecret) to mount a hosted modal — no iframe
// embedding needed by us.
//
// Public key is read from import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY.
// Falls back to a placeholder string in DEV / fixture mode; the actual
// modal won't open without a real key.

import { loadStripe, type Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  const publishableKey =
    (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ?? '';
  if (!publishableKey) {
    // No key in env → return null promise; caller should fall back to a fixture
    // beat. TODO(PFL-STRIPE): wire publishable key in deployed envs.
    stripePromise = Promise.resolve(null);
    return stripePromise;
  }
  stripePromise = loadStripe(publishableKey);
  return stripePromise;
}
