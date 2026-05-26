import { describe, it, expect, vi } from 'vitest';
import { SessionRepository } from '../session.repository.js';

function makeRepo(findManyImpl: (args: unknown) => unknown) {
  const prisma = { session: { findMany: vi.fn(findManyImpl) } };
  return { repo: new SessionRepository(prisma as never), prisma };
}

describe('SessionRepository recall methods', () => {
  it('findRecentForRecall returns id/topic/createdAt/firstUserMessages and excludes a session', async () => {
    const created = new Date('2026-05-20T00:00:00.000Z');
    const { repo, prisma } = makeRepo(() => [
      {
        id: 's1',
        topic: null,
        createdAt: created,
        sessionMessages: [{ content: 'hi' }, { content: 'do the thing' }],
      },
    ]);

    const out = await repo.findRecentForRecall('u1', 10, 'current-session');

    expect(out).toEqual([
      { id: 's1', topic: null, createdAt: created, firstUserMessages: ['hi', 'do the thing'] },
    ]);
    const args = prisma.session.findMany.mock.calls[0]![0] as {
      where: { userId: string; id?: { not: string } };
      take: number;
      orderBy: { createdAt: string };
      select: { sessionMessages: { where: { role: string }; take: number } };
    };
    expect(args.where.userId).toBe('u1');
    expect(args.where.id).toEqual({ not: 'current-session' });
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(args.select.sessionMessages.where).toEqual({ role: 'user' });
    expect(args.select.sessionMessages.take).toBe(3);
  });

  it('findRecallTitleData returns one entry per requested session id', async () => {
    const created = new Date('2026-05-20T00:00:00.000Z');
    const { repo } = makeRepo(() => [
      { id: 's2', topic: 'Named', createdAt: created, sessionMessages: [{ content: 'q' }] },
    ]);

    const out = await repo.findRecallTitleData(['s2']);

    expect(out).toEqual([
      { id: 's2', topic: 'Named', createdAt: created, firstUserMessages: ['q'] },
    ]);
  });

  it('findRecallTitleData returns [] for an empty id list without querying', async () => {
    const { repo, prisma } = makeRepo(() => []);
    const out = await repo.findRecallTitleData([]);
    expect(out).toEqual([]);
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });
});
