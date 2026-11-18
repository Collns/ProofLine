import { defineConfig } from 'vitest/config';

// Test-only config. Kept separate from vite.config.ts because vitest 2.x
// bundles its own vite types, which don't accept the app's vite 6 plugins.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
