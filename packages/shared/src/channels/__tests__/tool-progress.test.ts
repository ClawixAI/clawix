import { describe, expect, it } from 'vitest';

import { resolveToolProgressMode, isToolProgressMode } from '../tool-progress.js';

describe('resolveToolProgressMode', () => {
  it('returns platform default when override is null', () => {
    expect(resolveToolProgressMode('telegram', null)).toBe('all');
    expect(resolveToolProgressMode('whatsapp', null)).toBe('new');
    expect(resolveToolProgressMode('slack', null)).toBe('off');
    expect(resolveToolProgressMode('web', null)).toBe('all');
  });

  it('returns platform default when override is undefined', () => {
    expect(resolveToolProgressMode('telegram', undefined)).toBe('all');
  });

  it('returns the override when it is a valid mode', () => {
    expect(resolveToolProgressMode('telegram', 'off')).toBe('off');
    expect(resolveToolProgressMode('telegram', 'new')).toBe('new');
    expect(resolveToolProgressMode('telegram', 'all')).toBe('all');
    expect(resolveToolProgressMode('telegram', 'verbose')).toBe('verbose');
  });

  it('falls back to platform default when override is invalid', () => {
    expect(resolveToolProgressMode('telegram', 'bogus')).toBe('all');
    expect(resolveToolProgressMode('slack', 'BOGUS')).toBe('off');
    expect(resolveToolProgressMode('whatsapp', '')).toBe('new');
  });
});

describe('isToolProgressMode', () => {
  it('accepts the four valid modes', () => {
    expect(isToolProgressMode('off')).toBe(true);
    expect(isToolProgressMode('new')).toBe(true);
    expect(isToolProgressMode('all')).toBe(true);
    expect(isToolProgressMode('verbose')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isToolProgressMode('OFF')).toBe(false);
    expect(isToolProgressMode('')).toBe(false);
    expect(isToolProgressMode(null)).toBe(false);
    expect(isToolProgressMode(undefined)).toBe(false);
    expect(isToolProgressMode(42)).toBe(false);
  });
});
