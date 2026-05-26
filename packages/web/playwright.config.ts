/**
 * Playwright configuration for @clawix/web E2E tests.
 *
 * Prerequisites:
 *   pnpm --filter @clawix/web add -D @playwright/test
 *   pnpm --filter @clawix/web exec playwright install chromium
 *
 * Run all E2E specs:
 *   pnpm --filter @clawix/web exec playwright test
 *
 * Run only the wiki spec:
 *   pnpm --filter @clawix/web exec playwright test e2e/wiki.spec.ts
 *
 * The web dev server must be running at WEB_BASE_URL (default http://localhost:3000).
 * The API must also be running at API_BASE_URL (default http://localhost:3001).
 */

import { defineConfig, devices } from '@playwright/test';

const WEB_BASE_URL = process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: WEB_BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Uncomment to auto-start the Next.js dev server during test runs:
  // webServer: {
  //   command: 'pnpm dev',
  //   url: WEB_BASE_URL,
  //   reuseExistingServer: true,
  //   timeout: 120_000,
  // },
});
