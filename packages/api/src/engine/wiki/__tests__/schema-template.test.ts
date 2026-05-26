import { describe, it, expect } from 'vitest';
import { loadSchemaTemplate } from '../schema-template.js';

describe('loadSchemaTemplate', () => {
  it('returns a non-empty markdown string starting with the Wiki Schema heading', async () => {
    const tpl = await loadSchemaTemplate();
    expect(tpl.length).toBeGreaterThan(100);
    expect(tpl).toMatch(/^# Wiki Schema/);
  });

  it('returns the same string on subsequent calls (cached)', async () => {
    const a = await loadSchemaTemplate();
    const b = await loadSchemaTemplate();
    expect(a).toBe(b);
  });
});
