/**
 * Integration test for SessionMessageSearchRepository — real SQL against local
 * Postgres (pg_trgm + tsvector). Skips gracefully when DATABASE_URL is unset.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config as dotenvConfig } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { SessionMessageSearchRepository } from '../session-message-search.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..', '..', '..');
const envPath = resolve(repoRoot, '.env');
if (existsSync(envPath)) dotenvConfig({ path: envPath, override: false });

const DATABASE_URL = process.env['DATABASE_URL'];

function makePrismaClient(): PrismaClient {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
}

describe('SessionMessageSearchRepository (integration)', () => {
  let prisma: PrismaClient;
  let search: SessionMessageSearchRepository;
  let dbReachable = false;

  const userIds: string[] = [];
  const sessionIds: string[] = [];

  beforeAll(async () => {
    if (!DATABASE_URL) {
      console.warn('Skipping session-search integration tests: DATABASE_URL not set');
      return;
    }
    try {
      prisma = makePrismaClient();
      await prisma.$connect();
      await prisma.$queryRawUnsafe('SELECT 1');
      dbReachable = true;
    } catch (e) {
      console.warn('Skipping session-search integration tests: DB not reachable', e);
      return;
    }
    search = new SessionMessageSearchRepository(prisma as never);
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (!dbReachable) return;
    if (sessionIds.length) {
      await prisma.session
        .deleteMany({ where: { id: { in: [...sessionIds] } } })
        .catch(() => undefined);
      sessionIds.length = 0;
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } }).catch(() => undefined);
      userIds.length = 0;
    }
  });

  async function makeUser(): Promise<string> {
    const policy = await prisma.policy.findFirst({ select: { id: true } });
    if (!policy) throw new Error('No policy row found in DB — run seed first');
    const u = await prisma.user.create({
      data: {
        email: `sessionsearch-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
        name: 'session-search-test',
        passwordHash: 'x',
        role: 'developer',
        policyId: policy.id,
      },
      select: { id: true },
    });
    userIds.push(u.id);
    return u.id;
  }

  async function makeSession(
    userId: string,
    messages: { role: string; content: string; archivedAt?: Date; createdAt?: Date }[],
  ): Promise<string> {
    const agent = await prisma.agentDefinition.findFirst({ select: { id: true } });
    if (!agent) throw new Error('No agentDefinition row found in DB — run seed first');
    const session = await prisma.session.create({
      data: { userId, agentDefinitionId: agent.id },
      select: { id: true },
    });
    sessionIds.push(session.id);
    await prisma.sessionMessage.createMany({
      data: messages.map((m, i) => ({
        sessionId: session.id,
        role: m.role,
        content: m.content,
        ordering: i,
        ...(m.archivedAt ? { archivedAt: m.archivedAt } : {}),
        ...(m.createdAt ? { createdAt: m.createdAt } : {}),
      })),
    });
    return session.id;
  }

  it('full-text matches words in user/assistant messages', async () => {
    if (!dbReachable) return;
    const userId = await makeUser();
    const sid = await makeSession(userId, [
      { role: 'user', content: 'help me with the deployment pipeline' },
      { role: 'assistant', content: 'sure, here is the kubernetes config' },
    ]);

    const hits = await search.search({ userId, query: 'deployment', limit: 10 });
    expect(hits.some((h) => h.sessionId === sid)).toBe(true);
  });

  it('excludes tool and system messages', async () => {
    if (!dbReachable) return;
    const userId = await makeUser();
    await makeSession(userId, [
      { role: 'tool', content: 'UNIQUEWORDXYZ from a giant file dump' },
      { role: 'system', content: 'UNIQUEWORDXYZ skill staleness hint' },
    ]);

    const hits = await search.search({ userId, query: 'UNIQUEWORDXYZ', limit: 10 });
    expect(hits).toHaveLength(0);
  });

  it('includes archived messages', async () => {
    if (!dbReachable) return;
    const userId = await makeUser();
    const sid = await makeSession(userId, [
      { role: 'user', content: 'archivedtopic discussion', archivedAt: new Date() },
    ]);

    const hits = await search.search({ userId, query: 'archivedtopic', limit: 10 });
    expect(hits.some((h) => h.sessionId === sid)).toBe(true);
  });

  it('respects the days recency floor', async () => {
    if (!dbReachable) return;
    const userId = await makeUser();
    const oldSid = await makeSession(userId, [
      {
        role: 'user',
        content: 'recencyfloorword from ten days ago',
        createdAt: new Date(Date.now() - 10 * 86_400_000),
      },
    ]);
    const recentSid = await makeSession(userId, [
      { role: 'user', content: 'recencyfloorword from just now' },
    ]);

    const hits = await search.search({ userId, query: 'recencyfloorword', days: 3, limit: 10 });
    const sessionIdsHit = hits.map((h) => h.sessionId);
    expect(sessionIdsHit).toContain(recentSid);
    expect(sessionIdsHit).not.toContain(oldSid);
  });

  it('tolerates a typo via trigram', async () => {
    if (!dbReachable) return;
    const userId = await makeUser();
    const sid = await makeSession(userId, [
      { role: 'user', content: 'configure the authentication middleware' },
    ]);

    const hits = await search.search({ userId, query: 'authentcation', limit: 5 });
    expect(hits.some((h) => h.sessionId === sid)).toBe(true);
  });

  it("never returns another user's messages", async () => {
    if (!dbReachable) return;
    const owner = await makeUser();
    const other = await makeUser();
    await makeSession(other, [{ role: 'user', content: 'secretkeyword only the other user said' }]);

    const hits = await search.search({ userId: owner, query: 'secretkeyword', limit: 10 });
    expect(hits).toHaveLength(0);
  });
});
