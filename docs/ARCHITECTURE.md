# Architecture rules

## Layering
- Apps depend on use-case packages
- Use-case packages depend on primitives
- Primitives depend on nothing internal
- Cycles are forbidden

## Adapter pattern (mandatory for external services)
Every external service sits behind an interface. Concrete 
implementations live in `src/providers/`, named after the vendor. 
Each interface ships with at least one production adapter and one 
stub adapter for tests.

Examples:
- `@proofline/kyb` exposes `KYBProvider`. Implementations: 
  `providers/middesk.ts`, `providers/stripe-identity.ts`, 
  `providers/composite.ts`, `providers/stub.ts`
- `@proofline/email` exposes `EmailProvider`. Implementations: 
  `providers/resend.ts`, `providers/stub.ts`
- `@proofline/kms` exposes the KMS-backed `CryptoProvider`. 
  Implementations: `providers/gcp-kms.ts`, `providers/stub.ts`
- `@proofline/observability` exposes `ObservabilityProvider`. 
  Implementations: `providers/sentry.ts`, `providers/stub.ts`
- `@proofline/anchoring` exposes `AnchorProvider`. Implementations: 
  `providers/viem-base-sepolia.ts`, `providers/stub.ts`
- `@proofline/ai` exposes `AIProvider`. Implementations: 
  `providers/gemini.ts`, `providers/stub.ts`

## Composition
Apps wire concrete providers at startup ONLY. Use-case packages 
receive providers via dependency injection (constructor or factory 
parameter). Use-case packages never import vendor SDKs.

## Forbidden imports
- Apps importing `src/providers/*` directly from another package 
  (must go through the package's public interface and inject at 
  the app edge)
- Apps or packages importing from `@proofline/design-prototype`
- Cross-app imports (apps cannot import from each other)
- Cycles between packages

## Enforcement
- Code review (every PR)
- ESLint import boundaries (added in a later commit)
- Test isolation: every package's test suite must run with stub 
  providers only, never real API keys
