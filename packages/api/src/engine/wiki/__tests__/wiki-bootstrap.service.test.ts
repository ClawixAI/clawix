/**
 * Integration tests for WikiBootstrapService.ensureMigrated.
 *
 * Runs real SQL against the local Postgres instance and real filesystem
 * fixtures via os.tmpdir(). Requires DATABASE_URL to be reachable. If the
 * DB is unreachable the suite is skipped gracefully (each test early-returns).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { config as dotenvConfig } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client.js';
import { WikiPageRepository } from '../../../db/wiki-page.repository.js';
import { UserRepository } from '../../../db/user.repository.js';
import { PolicyRepository } from '../../../db/policy.repository.js';
import { WikiBootstrapService } from '../wiki-bootstrap.service.js';

// Load env from the monorepo root.
// This file lives at packages/api/src/engine/wiki/__tests__/ — six dirs up is the repo root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..', '..', '..', '..');
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

describe('WikiBootstrapService.ensureMigrated (integration)', () => {
  let prisma: PrismaClient;
  let pages: WikiPageRepository;
  let svc: WikiBootstrapService;
  let dbReachable = false;

  /** Tracks user ids created by the current test for cleanup. */
  const createdUserIds: string[] = [];
  /** Tracks temp dirs created by the current test for cleanup. */
  const createdTmpDirs: string[] = [];

  beforeAll(async () => {
    if (!DATABASE_URL) {
      console.warn('Skipping wiki-bootstrap integration tests: DATABASE_URL not set');
      return;
    }
    try {
      prisma = makePrismaClient();
      await prisma.$connect();
      await prisma.$queryRawUnsafe('SELECT 1');
      dbReachable = true;
    } catch (e) {
      console.warn('Skipping wiki-bootstrap integration tests: DB not reachable', e);
      return;
    }

    pages = new WikiPageRepository(prisma as never);
    const users = new UserRepository(prisma as never);
    const policies = new PolicyRepository(prisma as never);
    svc = new WikiBootstrapService(prisma as never, pages, users, policies);
  });

  afterEach(async () => {
    if (!dbReachable) return;

    // Clean up WikiPage rows created during the test.
    if (createdUserIds.length) {
      await prisma.wikiPage
        .deleteMany({ where: { ownerId: { in: [...createdUserIds] } } })
        .catch(() => undefined);
      await prisma.user
        .deleteMany({ where: { id: { in: [...createdUserIds] } } })
        .catch(() => undefined);
      createdUserIds.length = 0;
    }

    // Remove temp dirs.
    for (const d of createdTmpDirs) {
      await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
    }
    createdTmpDirs.length = 0;
  });

  afterAll(async () => {
    if (dbReachable) await prisma.$disconnect();
  });

  /**
   * Helper: create a throwaway user with the first available policy and track
   * it for cleanup.
   */
  async function createTestUser(policyOverrides?: { maxAmbientPages?: number }): Promise<string> {
    let policyId: string;

    if (policyOverrides) {
      // Create a dedicated policy for this test with the requested overrides.
      const pol = await prisma.policy.create({
        data: {
          name: `bootstrap-test-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          maxAmbientPages: policyOverrides.maxAmbientPages ?? 5,
          allowedProviders: ['anthropic'],
        },
        select: { id: true },
      });
      policyId = pol.id;
    } else {
      const pol = await prisma.policy.findFirst({ select: { id: true } });
      if (!pol) throw new Error('No policy row found in DB — run seed first');
      policyId = pol.id;
    }

    const u = await prisma.user.create({
      data: {
        email: `bootstrap-test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
        name: 'bootstrap-test-user',
        passwordHash: 'x',
        role: 'developer',
        policyId,
      },
      select: { id: true },
    });
    createdUserIds.push(u.id);
    return u.id;
  }

  /**
   * Helper: create a fresh temp workspace directory and track it for cleanup.
   */
  async function createWorkspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clawix-bootstrap-test-'));
    createdTmpDirs.push(dir);
    return dir;
  }

  // ─────────────────────────────────────────────────────────────────
  // 1. MEMORY.md ingest + _schema seed; USER.md left in place
  // ─────────────────────────────────────────────────────────────────

  it('ingests MEMORY.md as ambient pages and seeds _schema; leaves USER.md in place', async () => {
    if (!dbReachable) return;

    const userId = await createTestUser();
    const workspaceDir = await createWorkspace();

    await fs.mkdir(path.join(workspaceDir, 'memory'), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'USER.md'), '# Profile\nUser is left-handed.');
    await fs.writeFile(
      path.join(workspaceDir, 'memory', 'MEMORY.md'),
      '## Project context\nWorking on Clawix.\n## Preferences\nPrefers ISO dates.',
    );

    await svc.ensureMigrated(userId, workspaceDir);

    const owned = await pages.listOwnedByUser(userId, { limit: 50 });

    // USER.md is NOT ingested as a wiki page
    const profile = owned.find((p) => p.tags.includes('kind:profile'));
    expect(profile).toBeUndefined();

    // MEMORY.md → at least 2 ambient pages (one per ## section)
    const ambientNonSchema = owned.filter(
      (p) => p.scope === 'AMBIENT' && !p.tags.includes('kind:schema'),
    );
    expect(ambientNonSchema.length).toBeGreaterThanOrEqual(2);

    // _schema page must exist
    const schema = await pages.findBySlug(userId, '_schema');
    expect(schema).toBeTruthy();
    expect(schema?.tags).toContain('kind:schema');

    // MEMORY.md moved to .migrated/; USER.md NOT moved
    const migratedDir = path.join(workspaceDir, 'memory', '.migrated');
    const migratedFiles = await fs.readdir(migratedDir);
    expect(migratedFiles).toContain('MEMORY.md');
    expect(migratedFiles).not.toContain('USER.md');

    // MEMORY.md gone; USER.md still in place
    await expect(fs.access(path.join(workspaceDir, 'memory', 'MEMORY.md'))).rejects.toThrow();
    const userMd = await fs.readFile(path.join(workspaceDir, 'USER.md'), 'utf-8');
    expect(userMd).toContain('User is left-handed');
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. Idempotency — second call does nothing (user already migrated)
  // ─────────────────────────────────────────────────────────────────

  it('is idempotent — second run does nothing because user is marked migrated', async () => {
    if (!dbReachable) return;

    const userId = await createTestUser();
    const workspaceDir = await createWorkspace();

    await fs.mkdir(path.join(workspaceDir, 'memory'), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'USER.md'), '# Profile\nSome profile text.');

    await svc.ensureMigrated(userId, workspaceDir);
    const countBefore = await pages.countOwnedBy(userId);

    // Second call on the same workspace (files already moved, user already stamped)
    await svc.ensureMigrated(userId, workspaceDir);
    const countAfter = await pages.countOwnedBy(userId);

    expect(countAfter).toBe(countBefore);

    // wikiMigratedAt is set
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.wikiMigratedAt).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Ambient cap respected when MEMORY.md has more sections than cap
  // ─────────────────────────────────────────────────────────────────

  it('respects ambient cap when ingesting MEMORY.md sections', async () => {
    if (!dbReachable) return;

    // Create a policy with cap = 5 (default) so the test is deterministic.
    const userId = await createTestUser({ maxAmbientPages: 5 });
    const workspaceDir = await createWorkspace();

    await fs.mkdir(path.join(workspaceDir, 'memory'), { recursive: true });
    // 8 sections → only cap-many should be AMBIENT; the rest ARCHIVED
    const sections = Array.from({ length: 8 }, (_, i) => `## Section ${i}\nbody ${i}`).join('\n');
    await fs.writeFile(path.join(workspaceDir, 'memory', 'MEMORY.md'), sections);

    await svc.ensureMigrated(userId, workspaceDir);

    const ambientPages = await pages.listOwnedByUser(userId, { scope: 'AMBIENT', limit: 50 });
    // _schema also counts as AMBIENT, so total AMBIENT ≤ cap (5)
    expect(ambientPages.length).toBeLessThanOrEqual(5);

    const allOwned = await pages.listOwnedByUser(userId, { limit: 50 });
    // All 8 sections + _schema are created
    expect(allOwned.length).toBeGreaterThanOrEqual(8);
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. Minimal case: no files → seeds _schema, marks migrated
  // ─────────────────────────────────────────────────────────────────

  it('does nothing when neither USER.md nor MEMORY.md exists, but still seeds _schema and marks migrated', async () => {
    if (!dbReachable) return;

    const userId = await createTestUser();
    const workspaceDir = await createWorkspace();
    // No files written — empty workspace

    await svc.ensureMigrated(userId, workspaceDir);

    const schema = await pages.findBySlug(userId, '_schema');
    expect(schema).toBeTruthy();
    expect(schema?.tags).toContain('kind:schema');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.wikiMigratedAt).not.toBeNull();
  });
});
