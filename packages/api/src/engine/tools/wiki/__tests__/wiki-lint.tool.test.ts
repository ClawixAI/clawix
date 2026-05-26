import { describe, it, expect } from 'vitest';
import { createWikiLintTool } from '../wiki-lint.tool.js';

describe('wiki_lint tool', () => {
  function makePagesRepo(
    rows: {
      id: string;
      slug: string;
      title: string;
      summary: string;
      content: string;
      tags: string[];
      scope: 'AMBIENT' | 'ARCHIVED';
      ownerId: string;
      updatedAt: Date;
    }[],
  ) {
    return {
      listOwnedByUser: async (ownerId: string) => rows.filter((p) => p.ownerId === ownerId),
    };
  }
  function makeLinksRepo(
    backlinks: Record<string, { id: string; fromPageId: string; toPageId: string }[]>,
  ) {
    return {
      findBacklinks: async (pageId: string) => backlinks[pageId] ?? [],
    };
  }
  function makeAudit() {
    const calls: unknown[] = [];
    return {
      create: async (data: unknown) => {
        calls.push(data);
      },
      calls,
    };
  }

  it('flags orphan pages (no backlinks, not daily, not ambient)', async () => {
    const pages = makePagesRepo([
      {
        id: 'p1',
        slug: 'orphan',
        title: 'Orphan',
        summary: 's',
        content: 'c',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
    ]);
    const links = makeLinksRepo({});
    const audit = makeAudit();
    const tool = createWikiLintTool(pages as never, links as never, audit as never, 'u1');
    const res = await tool.execute({ checks: ['orphans'] });
    const findings = JSON.parse(res.output);
    expect(
      findings.find(
        (f: { finding: string; slug: string }) => f.finding === 'orphans' && f.slug === 'orphan',
      ),
    ).toBeTruthy();
  });

  it('does NOT flag ambient or daily-tagged pages as orphans', async () => {
    const pages = makePagesRepo([
      {
        id: 'p1',
        slug: 'pinned',
        title: 'Pinned',
        summary: 's',
        content: 'c',
        tags: [],
        scope: 'AMBIENT',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
      {
        id: 'p2',
        slug: 'today',
        title: 'Today',
        summary: 's',
        content: 'c',
        tags: ['daily:2026-05-17'],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
    ]);
    const links = makeLinksRepo({});
    const audit = makeAudit();
    const tool = createWikiLintTool(pages as never, links as never, audit as never, 'u1');
    const res = await tool.execute({ checks: ['orphans'] });
    expect(JSON.parse(res.output)).toHaveLength(0);
  });

  it('flags missing summaries', async () => {
    const pages = makePagesRepo([
      {
        id: 'p1',
        slug: 'x',
        title: 'X',
        summary: '',
        content: 'c',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
      {
        id: 'p2',
        slug: 'y',
        title: 'Y',
        summary: '   ',
        content: 'c',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
      {
        id: 'p3',
        slug: 'z',
        title: 'Z',
        summary: 'ok',
        content: 'c',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
    ]);
    const links = makeLinksRepo({});
    const audit = makeAudit();
    const tool = createWikiLintTool(pages as never, links as never, audit as never, 'u1');
    const res = await tool.execute({ checks: ['missing-summaries'] });
    const findings = JSON.parse(res.output);
    const slugs = findings.map((f: { slug: string }) => f.slug);
    expect(slugs).toContain('x');
    expect(slugs).toContain('y');
    expect(slugs).not.toContain('z');
  });

  it('flags broken [[slug]] links', async () => {
    const pages = makePagesRepo([
      {
        id: 'p1',
        slug: 'src',
        title: 'Source',
        summary: 's',
        content: 'see [[missing-page]] and [[exists]]',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
      {
        id: 'p2',
        slug: 'exists',
        title: 'E',
        summary: 's',
        content: '',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
    ]);
    const links = makeLinksRepo({});
    const audit = makeAudit();
    const tool = createWikiLintTool(pages as never, links as never, audit as never, 'u1');
    const res = await tool.execute({ checks: ['broken-links'] });
    const findings = JSON.parse(res.output);
    const broken = findings.filter(
      (f: { finding: string; slug: string }) => f.finding === 'broken-links' && f.slug === 'src',
    );
    expect(broken).toHaveLength(1);
    expect(broken[0].suggestion).toMatch(/missing-page/);
  });

  it('flags stale-claims (>180 days + date markers, not daily)', async () => {
    const longAgo = new Date(Date.now() - 200 * 86400_000);
    const pages = makePagesRepo([
      {
        id: 'p1',
        slug: 'old',
        title: 'Old',
        summary: 's',
        content: 'as of 2022, ...',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: longAgo,
      },
      {
        id: 'p2',
        slug: 'fresh',
        title: 'Fresh',
        summary: 's',
        content: 'as of 2022, ...',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
      {
        id: 'p3',
        slug: 'daily',
        title: 'D',
        summary: 's',
        content: 'as of 2022, ...',
        tags: ['daily:2026-05-17'],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: longAgo,
      },
    ]);
    const links = makeLinksRepo({});
    const audit = makeAudit();
    const tool = createWikiLintTool(pages as never, links as never, audit as never, 'u1');
    const res = await tool.execute({ checks: ['stale-claims'] });
    const findings = JSON.parse(res.output);
    const slugs = findings.map((f: { slug: string }) => f.slug);
    expect(slugs).toContain('old');
    expect(slugs).not.toContain('fresh');
    expect(slugs).not.toContain('daily');
  });

  it('ignores pages not owned by caller', async () => {
    const pages = makePagesRepo([
      {
        id: 'p1',
        slug: 'theirs',
        title: 'X',
        summary: 's',
        content: 'c',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'other',
        updatedAt: new Date(),
      },
    ]);
    const links = makeLinksRepo({});
    const audit = makeAudit();
    const tool = createWikiLintTool(pages as never, links as never, audit as never, 'u1');
    const res = await tool.execute({});
    expect(JSON.parse(res.output)).toHaveLength(0);
  });

  it('writes wiki.lint audit row with findingsCount', async () => {
    const pages = makePagesRepo([
      {
        id: 'p1',
        slug: 'orphan',
        title: 'X',
        summary: 's',
        content: 'c',
        tags: [],
        scope: 'ARCHIVED',
        ownerId: 'u1',
        updatedAt: new Date(),
      },
    ]);
    const links = makeLinksRepo({});
    const audit = makeAudit();
    const tool = createWikiLintTool(pages as never, links as never, audit as never, 'u1');
    await tool.execute({});
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({
      action: 'wiki.lint',
      details: expect.objectContaining({ findingsCount: expect.any(Number) }),
    });
  });

  it('clamps maxResults', async () => {
    const pages = makePagesRepo(
      Array.from({ length: 150 }, (_, i) => ({
        id: `p${i}`,
        slug: `s${i}`,
        title: `T${i}`,
        summary: '',
        content: 'c',
        tags: [],
        scope: 'ARCHIVED' as const,
        ownerId: 'u1',
        updatedAt: new Date(),
      })),
    );
    const links = makeLinksRepo({});
    const audit = makeAudit();
    const tool = createWikiLintTool(pages as never, links as never, audit as never, 'u1');
    const res = await tool.execute({ checks: ['missing-summaries'], maxResults: 9999 });
    const findings = JSON.parse(res.output);
    expect(findings.length).toBeLessThanOrEqual(100);
  });
});
