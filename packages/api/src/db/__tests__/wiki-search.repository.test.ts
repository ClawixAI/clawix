/**
 * Integration test for WikiSearchRepository.
 *
 * Runs real SQL against the local Postgres instance (pg_trgm + tsvector).
 * Requires DATABASE_URL to be reachable. If the DB is unreachable the suite
 * is skipped gracefully (each test early-returns).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { WikiPageRepository } from '../wiki-page.repository.js';
import { WikiSearchRepository } from '../wiki-search.repository.js';

// Load env from the monorepo root. This file lives at
// packages/api/src/db/__tests__/ — five directories up is the repo root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..', '..', '..');
const envPath = resolve(repoRoot, '.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath, override: false });
}

const DATABASE_URL = process.env['DATABASE_URL'];

function makePrismaClient(): PrismaClient {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  return new PrismaClient({ adapter });
}

describe('WikiSearchRepository (integration)', () => {
  let prisma: PrismaClient;
  let pages: WikiPageRepository;
  let search: WikiSearchRepository;
  let dbReachable = false;

  // Track created rows for cleanup.
  const createdUserIds: string[] = [];
  const createdPageIds: string[] = [];

  beforeAll(async () => {
    if (!DATABASE_URL) {
      console.warn('Skipping wiki-search integration tests: DATABASE_URL not set');
      return;
    }
    try {
      prisma = makePrismaClient();
      await prisma.$connect();
      await prisma.$queryRawUnsafe('SELECT 1');
      dbReachable = true;
    } catch (e) {
      console.warn('Skipping wiki-search integration tests: DB not reachable', e);
      return;
    }
    pages = new WikiPageRepository(prisma as never);
    search = new WikiSearchRepository(prisma as never);
  });

  afterAll(async () => {
    if (!dbReachable) return;
    if (createdPageIds.length) {
      await prisma.wikiPage
        .deleteMany({ where: { id: { in: [...createdPageIds] } } })
        .catch(() => undefined);
    }
    if (createdUserIds.length) {
      await prisma.user
        .deleteMany({ where: { id: { in: [...createdUserIds] } } })
        .catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (!dbReachable) return;
    // Clean up pages created during each test to avoid cross-test interference.
    if (createdPageIds.length) {
      await prisma.wikiPage
        .deleteMany({ where: { id: { in: [...createdPageIds] } } })
        .catch(() => undefined);
      createdPageIds.length = 0;
    }
    if (createdUserIds.length) {
      await prisma.user
        .deleteMany({ where: { id: { in: [...createdUserIds] } } })
        .catch(() => undefined);
      createdUserIds.length = 0;
    }
  });

  /** Helper: create a throwaway user for the current test. */
  async function createTestUser(): Promise<string> {
    const policy = await prisma.policy.findFirst({ select: { id: true } });
    if (!policy) throw new Error('No policy row found in DB — run seed first');
    const u = await prisma.user.create({
      data: {
        email: `wikisearch-inttest-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
        name: 'wiki-search-test',
        passwordHash: 'x',
        role: 'developer',
        policyId: policy.id,
      },
      select: { id: true },
    });
    createdUserIds.push(u.id);
    return u.id;
  }

  /** Helper: create a page and track its id for cleanup. */
  async function createPage(ownerId: string, title: string, content: string, tags: string[] = []) {
    const page = await pages.create({ ownerId, title, summary: 'test-summary', content, tags });
    createdPageIds.push(page.id);
    return page;
  }

  it('full-text matches words in content', async () => {
    if (!dbReachable) return;

    const userId = await createTestUser();
    await createPage(userId, 'Running guide', 'how to run fast and train daily');
    await createPage(userId, 'Cooking basics', 'pasta recipe tomato sauce');

    const res = await search.search({ userId, query: 'run', ownership: 'mine', limit: 10 });

    const titles = res.map((r) => r.title);
    expect(titles).toContain('Running guide');
    // The running guide must score higher than the unrelated cooking page.
    const runningIdx = titles.indexOf('Running guide');
    const cookingIdx = titles.indexOf('Cooking basics');
    if (cookingIdx !== -1) {
      expect(runningIdx).toBeLessThan(cookingIdx);
    }
  });

  it('trigram tolerates a typo in the query', async () => {
    if (!dbReachable) return;

    const userId = await createTestUser();
    await createPage(userId, 'Vacation policy', 'PTO accrual and leave entitlement rules');

    const res = await search.search({ userId, query: 'vacatoin', ownership: 'mine', limit: 5 });

    // pg_trgm similarity should surface the vacation page even with the typo.
    expect(res.length).toBeGreaterThan(0);
    expect(res[0]?.title).toBe('Vacation policy');
  });

  it('respects tag pre-filter', async () => {
    if (!dbReachable) return;

    const userId = await createTestUser();
    await createPage(userId, 'Tagged HR', 'common keyword appears here', ['domain:hr']);
    await createPage(userId, 'Tagged Eng', 'common keyword appears here', ['domain:eng']);

    const res = await search.search({
      userId,
      query: 'common keyword',
      tags: ['domain:hr'],
      ownership: 'mine',
      limit: 10,
    });

    const titles = res.map((r) => r.title);
    expect(titles).toContain('Tagged HR');
    expect(titles).not.toContain('Tagged Eng');
  });
});
