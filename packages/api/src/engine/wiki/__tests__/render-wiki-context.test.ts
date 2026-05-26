import { describe, it, expect } from 'vitest';
import { renderWikiContext } from '../render-wiki-context.js';

describe('renderWikiContext', () => {
  const now = new Date('2026-05-17T00:00:00Z');

  function page(
    over: Partial<{
      id: string;
      slug: string;
      title: string;
      summary: string;
      content: string;
      tags: string[];
      scope: 'AMBIENT' | 'ARCHIVED';
      ownerId: string;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ) {
    return {
      id: over.id ?? 'p',
      slug: over.slug ?? 's',
      title: over.title ?? 'T',
      summary: over.summary ?? 's',
      content: over.content ?? 'c',
      tags: over.tags ?? [],
      scope: over.scope ?? 'ARCHIVED',
      ownerId: over.ownerId ?? 'u',
      createdAt: over.createdAt ?? now,
      updatedAt: over.updatedAt ?? now,
    } as never;
  }

  it('renders Long-term Memory, Wiki Schema, Wiki Index sections', () => {
    const out = renderWikiContext({
      now,
      ambientPages: [
        page({
          id: 'p2',
          slug: 'project',
          title: 'Current project',
          content: 'Clawix wiki redesign.',
          scope: 'AMBIENT',
        }),
      ],
      schemaPage: page({
        id: 's',
        slug: '_schema',
        title: 'Wiki Schema',
        content: '# Wiki Schema\nbody',
        tags: ['kind:schema'],
        scope: 'AMBIENT',
      }),
      indexPages: [
        page({
          id: 'p10',
          slug: 'leave-policy',
          title: 'Leave policy',
          summary: 'PTO rules',
          tags: ['domain:hr'],
        }),
        page({
          id: 'p11',
          slug: 'sql-patterns',
          title: 'SQL patterns',
          summary: 'parameterized',
          tags: ['domain:eng'],
        }),
        page({ id: 'p12', slug: 'misc', title: 'Misc', summary: 'random', tags: [] }),
      ],
      budgets: { ambient: 2200, schema: 500, index: 4000 },
    });

    // No dedicated User Profile section — User Profile is file-based (USER.md).
    expect(out).not.toMatch(/^## User Profile$/m);
    expect(out).toContain('## Long-term Memory');
    expect(out).toContain('Clawix wiki redesign');
    expect(out).toContain('## Wiki Schema');
    expect(out).toContain('## Wiki Index');
    expect(out).toContain('### domain:hr');
    expect(out).toContain('- leave-policy — "PTO rules"');
    expect(out).toContain('### (untagged)');
  });

  it('truncates over-budget sections with a [truncated] marker', () => {
    const big = 'a'.repeat(5000);
    const out = renderWikiContext({
      now,
      ambientPages: [page({ id: 'p', slug: 's', title: 'T', content: big, scope: 'AMBIENT' })],
      schemaPage: null,
      indexPages: [],
      budgets: { ambient: 200, schema: 500, index: 4000 },
    });
    expect(out).toMatch(/\[truncated\]/);
  });

  it('omits sections that have no input', () => {
    const out = renderWikiContext({
      now,
      ambientPages: [],
      schemaPage: null,
      indexPages: [],
      budgets: { ambient: 2200, schema: 500, index: 4000 },
    });
    expect(out).toBe('');
  });

  it('renders kind:profile pages alongside other ambient pages under Long-term Memory', () => {
    const out = renderWikiContext({
      now,
      ambientPages: [
        page({
          id: 'prof',
          slug: 'user-profile',
          title: 'User Profile',
          content: 'profile content',
          tags: ['kind:profile'],
          scope: 'AMBIENT',
        }),
        page({
          id: 'mem',
          slug: 'notes',
          title: 'Project Notes',
          content: 'ambient notes',
          scope: 'AMBIENT',
        }),
      ],
      schemaPage: null,
      indexPages: [],
      budgets: { ambient: 2200, schema: 500, index: 4000 },
    });

    // No dedicated User Profile section — kind:profile pages flow under Long-term Memory.
    expect(out).not.toMatch(/^## User Profile$/m);
    expect(out).toContain('## Long-term Memory');
    expect(out).toContain('profile content');
    expect(out).toContain('ambient notes');
  });

  it('renders only schema section when only schema page is provided', () => {
    const out = renderWikiContext({
      now,
      ambientPages: [],
      schemaPage: page({
        id: 'schema',
        slug: '_schema',
        title: 'Wiki Schema',
        content: 'Schema content',
        tags: ['kind:schema'],
        scope: 'AMBIENT',
      }),
      indexPages: [],
      budgets: { ambient: 2200, schema: 500, index: 4000 },
    });

    expect(out).toContain('## Wiki Schema');
    expect(out).toContain('Schema content');
    expect(out).not.toMatch(/^## User Profile$/m);
    expect(out).not.toContain('## Long-term Memory');
  });

  it('sorts domain groups alphabetically with untagged last', () => {
    const out = renderWikiContext({
      now,
      ambientPages: [],
      schemaPage: null,
      indexPages: [
        page({ id: 'z', slug: 'z', title: 'Z', summary: 'z', tags: ['domain:z-domain'] }),
        page({ id: 'a', slug: 'a', title: 'A', summary: 'a', tags: ['domain:a-domain'] }),
        page({ id: 'u', slug: 'u', title: 'U', summary: 'u', tags: [] }),
      ],
      budgets: { ambient: 2200, schema: 500, index: 4000 },
    });

    const aIdx = out.indexOf('### domain:a-domain');
    const zIdx = out.indexOf('### domain:z-domain');
    const uIdx = out.indexOf('### (untagged)');

    expect(aIdx).toBeLessThan(zIdx);
    expect(zIdx).toBeLessThan(uIdx);
  });
});
