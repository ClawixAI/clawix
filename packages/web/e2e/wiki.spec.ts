/**
 * Wiki page — Playwright E2E scaffolding
 *
 * Prerequisites (full stack):
 *   - PostgreSQL + Redis  (pnpm docker:dev)
 *   - API server          (pnpm --filter @clawix/api run dev)
 *   - Next.js dev server  (pnpm --filter @clawix/web run dev)
 *   - DB seed applied     (pnpm db:seed)
 *
 * Run:
 *   pnpm --filter @clawix/web exec playwright test e2e/wiki.spec.ts
 *
 * Auth:
 *   Tests rely on a `storageState` fixture (saved session cookies/localStorage)
 *   that logs in as an admin user. Until the auth fixture is wired, tests that
 *   require authentication are marked test.skip.
 *
 *   To implement auth fixture add a `e2e/fixtures.ts` that calls the login API,
 *   saves the JWT to localStorage, and exports a `test` with `storageState`.
 *   See: https://playwright.dev/docs/auth
 *
 * Note: @playwright/test is not yet installed. Add it with:
 *   pnpm --filter @clawix/web add -D @playwright/test
 *   pnpm --filter @clawix/web exec playwright install chromium
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Today's date in YYYY-MM-DD format (matches the daily-note title pattern). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Wiki page — basic navigation and structure
// ---------------------------------------------------------------------------

test.describe('Wiki page', () => {
  test.beforeEach(async ({ page }) => {
    // TODO: replace with a proper auth fixture once storageState is available.
    // For now, navigate directly — if the app redirects to /login the
    // assertions below will fail with a descriptive message.
    await page.goto('/wiki');
  });

  test('sidebar shows "Visible to me" tab and search input', async ({ page }) => {
    // The tabs rendered by the wiki page list
    await expect(page.getByRole('tab', { name: /visible to me/i })).toBeVisible();
    // Search input in the sidebar
    await expect(page.getByPlaceholder(/search/i)).toBeVisible();
  });

  test('"+ New daily note" button is rendered in the page list', async ({ page }) => {
    // WikiPageList always renders the "+ New daily note" button (T31).
    // It may appear inside the "Daily notes" group or as a standalone entry.
    const newDailyBtn = page.getByRole('button', { name: /\+ New daily note/i });
    await expect(newDailyBtn).toBeVisible();
  });

  test('create a daily note via the quick-capture button', async ({ page }) => {
    test.skip(
      true,
      'Requires auth fixture — implement when storageState login is wired in e2e/fixtures.ts',
    );

    const newDailyBtn = page.getByRole('button', { name: /\+ New daily note/i });
    await expect(newDailyBtn).toBeVisible();
    await newDailyBtn.click();

    // After clicking, the editor opens with the daily-note title in the title input.
    const today = todayIso();
    await expect(page.getByDisplayValue(new RegExp(`Daily — ${today}`))).toBeVisible();
  });

  test('selecting a page from the list opens it in the editor', async ({ page }) => {
    test.skip(
      true,
      'Requires at least one wiki page seeded and auth fixture — implement after db:seed and fixture wiring',
    );

    // Click the first page in the list
    const firstPage = page.locator('aside ul li button').first();
    await firstPage.click();

    // The editor area should appear (a textarea or CodeMirror editor)
    const editor = page.locator('main textarea, main .cm-editor');
    await expect(editor.first()).toBeVisible();
  });

  test('"Save" button is visible for admin/developer roles', async ({ page }) => {
    test.skip(
      true,
      'Requires auth fixture with admin role — implement when storageState login is wired',
    );

    // Selecting any page should expose the Save button in the editor
    const firstPage = page.locator('aside ul li button').first();
    await firstPage.click();
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Read-only viewer role
// ---------------------------------------------------------------------------

test.describe('Wiki page — viewer role', () => {
  test.skip(
    true,
    'Viewer fixture not yet wired — implement when role-based auth fixtures are added',
  );

  test('viewer sees no Save button', async ({ page }) => {
    await page.goto('/wiki');
    const firstPage = page.locator('aside ul li button').first();
    await firstPage.click();
    // Save button must NOT be present for a viewer
    await expect(page.getByRole('button', { name: /save/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Redirects (Phase 5 gating)
// ---------------------------------------------------------------------------

test.describe('Wiki redirects', () => {
  test.skip(
    true,
    '/memory → /wiki redirect is gated on Phase 5 (T35) — skip until MemoryRedirectController is registered',
  );

  test('/memory redirects to /wiki with 308', async ({ page }) => {
    const res = await page.goto('/memory');
    // Expect a permanent redirect that lands on /wiki
    expect(res?.status()).toBe(308);
    expect(page.url()).toContain('/wiki');
  });
});

// ---------------------------------------------------------------------------
// Tabbed shell — auth fixture required
// ---------------------------------------------------------------------------

test.describe('Wiki tabs', () => {
  test.skip(
    true,
    'Requires auth fixture — implement when storageState login is wired in e2e/fixtures.ts',
  );

  test.beforeEach(async ({ page }) => {
    await page.goto('/wiki');
  });

  test('Pages is the default tab', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Pages', selected: true })).toBeVisible();
  });

  test('switching to Schema updates the URL and shows the schema editor', async ({ page }) => {
    await page.getByRole('tab', { name: 'Schema' }).click();
    await expect(page).toHaveURL(/\?view=schema/);
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('switching to Graph updates the URL', async ({ page }) => {
    await page.getByRole('tab', { name: 'Graph' }).click();
    await expect(page).toHaveURL(/\?view=graph/);
  });

  test('/wiki/schema 308-redirects to /wiki?view=schema', async ({ page }) => {
    await page.goto('/wiki/schema');
    await expect(page).toHaveURL(/\/wiki\?view=schema$/);
    await expect(page.getByRole('tab', { name: 'Schema', selected: true })).toBeVisible();
  });

  test('sidebar shows a single Wiki entry (no Pages/Schema submenu)', async ({ page }) => {
    const wikiLinks = page.getByRole('link', { name: 'Wiki' });
    await expect(wikiLinks).toHaveCount(1);
    const navSchema = page.locator('nav').getByRole('link', { name: 'Schema' });
    await expect(navSchema).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Wiki Graph tab — auth fixture required
// ---------------------------------------------------------------------------

test.describe('Wiki Graph tab', () => {
  test.skip(
    true,
    'Requires auth fixture — implement when storageState login is wired in e2e/fixtures.ts',
  );

  test.beforeEach(async ({ page }) => {
    // Seed two linked pages via the API. Once the auth fixture is wired,
    // storageState cookies authenticate page.request automatically.
    const a = await page.request.post('/api/v1/wiki', {
      data: { title: 'Alpha', summary: 'a', content: 'see [[beta]]', tags: ['domain:hr'] },
    });
    expect(a.ok()).toBe(true);
    const b = await page.request.post('/api/v1/wiki', {
      data: { title: 'Beta', summary: 'b', content: 'see [[alpha]]', tags: ['domain:hr'] },
    });
    expect(b.ok()).toBe(true);
  });

  test('clicking a graph node populates the info panel; double-click opens the editor', async ({
    page,
  }) => {
    await page.goto('/wiki?view=graph');
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText('Selected')).toBeVisible();
    await expect(page.getByRole('button', { name: /Open in editor/ })).toBeVisible();

    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/view=pages.*id=/);
  });
});
