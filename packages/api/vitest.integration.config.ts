/**
 * Vitest configuration for browser integration tests.
 *
 * Run with:
 *   INTEGRATION=true BROWSER_AUTH_TOKEN=<token> pnpm vitest run --config vitest.integration.config.ts
 *
 * These tests are intentionally NOT included in the default `vitest.config.ts`
 * because they require a live Docker sidecar (clawix-browser). CI must set
 * INTEGRATION=true to enable them.
 */
import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@clawix/shared': path.resolve(import.meta.dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    name: 'browser-integration',
    globals: true,
    environment: 'node',
    include: ['test/integration/browser/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
