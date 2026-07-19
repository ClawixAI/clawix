import { describe, expect, it } from 'vitest';

import { downgradeChoice, offeredScopes } from '../approval.types.js';
import { redactParamsSummary } from '../params-summary.js';

describe('offeredScopes', () => {
  it('caps call-scoped tools at session in both directions', () => {
    expect(offeredScopes('call', false)).toEqual([
      'allow_once',
      'allow_session',
      'deny_once',
      'deny_session',
    ]);
  });
  it('offers only once-tier when the extractor failed', () => {
    expect(offeredScopes('resource', true)).toEqual(['allow_once', 'deny_once']);
  });
});

describe('downgradeChoice (symmetric, spec §6)', () => {
  const callOffered = offeredScopes('call', false);
  it('downgrades forged allow_always to allow_session', () => {
    expect(downgradeChoice('allow_always', callOffered)).toEqual({
      choice: 'allow_session',
      downgraded: true,
    });
  });
  it('downgrades forged deny_always to deny_session', () => {
    expect(downgradeChoice('deny_always', callOffered)).toEqual({
      choice: 'deny_session',
      downgraded: true,
    });
  });
  it('passes in-scope choices through untouched', () => {
    expect(downgradeChoice('deny_session', callOffered)).toEqual({
      choice: 'deny_session',
      downgraded: false,
    });
  });
});

describe('redactParamsSummary', () => {
  it('masks values under secret-shaped keys', () => {
    const out = redactParamsSummary({ apiKey: 'sk-12345', body: 'hello' });
    expect(out['apiKey']).toBe('***');
    expect(out['body']).toBe('hello');
  });
  it('masks secret-shaped values regardless of key', () => {
    const out = redactParamsSummary({ note: 'header Authorization: Bearer abc.def.ghi' });
    expect(out['note']).toContain('***');
    expect(out['note']).not.toContain('abc.def.ghi');
  });
  it('truncates long values to 200 chars with ellipsis', () => {
    const out = redactParamsSummary({ text: 'x'.repeat(500) });
    expect(out['text']).toHaveLength(201); // 200 + '…'
    expect(out['text']?.endsWith('…')).toBe(true);
  });
  it('stringifies non-string values', () => {
    expect(redactParamsSummary({ count: 3, nested: { a: 1 } })).toEqual({
      count: '3',
      nested: '{"a":1}',
    });
  });
});
