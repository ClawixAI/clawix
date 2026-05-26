import { describe, it, expect } from 'vitest';
import { registerWikiTools } from '../register.js';

describe('registerWikiTools', () => {
  function makeRegistry() {
    const names: string[] = [];
    return {
      registered: names,
      register: (t: { name: string }) => names.push(t.name),
    };
  }

  it('registers all core wiki tools including wiki_write', () => {
    const reg = makeRegistry();
    registerWikiTools(reg as never, {} as never, 'u1', { lintEnabled: true });
    expect(reg.registered).toEqual(
      expect.arrayContaining([
        'wiki_index',
        'wiki_read',
        'wiki_search',
        'wiki_write',
        'wiki_delete',
        'wiki_share',
        'wiki_unshare',
        'wiki_log',
        'wiki_lint',
      ]),
    );
  });

  it('skips wiki_lint when lintEnabled=false', () => {
    const reg = makeRegistry();
    registerWikiTools(reg as never, {} as never, 'u1', { lintEnabled: false });
    expect(reg.registered).not.toContain('wiki_lint');
  });

  it('still registers all other tools when lintEnabled=false', () => {
    const reg = makeRegistry();
    registerWikiTools(reg as never, {} as never, 'u1', { lintEnabled: false });
    expect(reg.registered).toEqual(
      expect.arrayContaining([
        'wiki_index',
        'wiki_read',
        'wiki_search',
        'wiki_write',
        'wiki_delete',
        'wiki_share',
        'wiki_unshare',
        'wiki_log',
      ]),
    );
  });

  it('registers exactly 9 tools when lintEnabled=true', () => {
    const reg = makeRegistry();
    registerWikiTools(reg as never, {} as never, 'u1', { lintEnabled: true });
    expect(reg.registered).toHaveLength(9);
  });

  it('registers exactly 8 tools when lintEnabled=false', () => {
    const reg = makeRegistry();
    registerWikiTools(reg as never, {} as never, 'u1', { lintEnabled: false });
    expect(reg.registered).toHaveLength(8);
  });
});
