export * from './types.js';
export * from './merkle.js';
// PFL-107: re-export the viem provider so apps can import it statically.
// The previous dynamic `require('@proofline/anchoring/dist/providers/...')`
// broke at runtime because esbuild bundles functions into one file and
// that path doesn't exist in the bundle. A normal import resolves cleanly.
export { makeViemBaseSepoliaAnchorProvider } from './providers/viem-base-sepolia.js';
export type { ViemAnchorConfig } from './providers/viem-base-sepolia.js';
