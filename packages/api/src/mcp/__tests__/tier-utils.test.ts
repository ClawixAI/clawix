import { describe, it, expect } from 'vitest';
import { parseTiersJson, normalizeTiers } from '../tier-utils.js';

describe('parseTiersJson', () => {
  it('parses bare JSON', () => {
    expect(parseTiersJson('{"recommended":["a"],"optional":[],"off":["b"]}')).toEqual({
      recommended: ['a'],
      optional: [],
      off: ['b'],
    });
  });
  it('strips markdown fences', () => {
    const out = parseTiersJson('```json\n{"recommended":["a"]}\n```');
    expect(out?.recommended).toEqual(['a']);
  });
  it('extracts the first JSON object from prose', () => {
    const out = parseTiersJson('Here you go: {"recommended":["a"]} thanks');
    expect(out?.recommended).toEqual(['a']);
  });
  it('returns null on garbage / null content', () => {
    expect(parseTiersJson('not json')).toBeNull();
    expect(parseTiersJson(null)).toBeNull();
  });
});

describe('normalizeTiers', () => {
  const catalog = ['search', 'create_issue', 'delete_repo'];

  it('drops names not in the catalog and partitions the rest', () => {
    const out = normalizeTiers(
      { recommended: ['search', 'ghost'], optional: ['create_issue'], off: ['delete_repo'] },
      catalog,
    );
    expect(out).toEqual({
      recommended: ['search'],
      optional: ['create_issue'],
      off: ['delete_repo'],
    });
  });

  it('puts catalog tools the LLM omitted into off', () => {
    const out = normalizeTiers({ recommended: ['search'] }, catalog);
    expect(out.recommended).toEqual(['search']);
    expect(out.off.sort()).toEqual(['create_issue', 'delete_repo']);
    expect(out.optional).toEqual([]);
  });

  it('applies precedence recommended > optional > off on duplicates', () => {
    const out = normalizeTiers({ recommended: ['search'], optional: ['search'], off: ['search'] }, [
      'search',
    ]);
    expect(out).toEqual({ recommended: ['search'], optional: [], off: [] });
  });

  it('handles null/empty input → everything off', () => {
    expect(normalizeTiers(null, catalog).off.sort()).toEqual([
      'create_issue',
      'delete_repo',
      'search',
    ]);
  });
});
