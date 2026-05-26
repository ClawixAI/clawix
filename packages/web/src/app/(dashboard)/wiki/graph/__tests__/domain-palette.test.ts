import { describe, expect, it } from 'vitest';
import { colorForDomain, hashHue } from '../domain-palette';

describe('colorForDomain', () => {
  it('returns the curated hex for known domains', () => {
    expect(colorForDomain('hr', false)).toBe('#4A90D9');
    expect(colorForDomain('infra', false)).toBe('#84CC16');
    expect(colorForDomain('product', false)).toBe('#EC4899');
    expect(colorForDomain('engineering', false)).toBe('#7C3AED');
    expect(colorForDomain('ops', false)).toBe('#1ABC9C');
  });

  it('uses the daily color when isDaily and no domain', () => {
    expect(colorForDomain(null, true)).toBe('#F39C12');
  });

  it('uses untagged color when no domain and not daily', () => {
    expect(colorForDomain(null, false)).toBe('#94A3B8');
  });

  it('returns deterministic HSL for unknown domains', () => {
    const a = colorForDomain('marketing', false);
    const b = colorForDomain('marketing', false);
    expect(a).toBe(b);
    expect(a).toMatch(/^hsl\(\d{1,3}, 65%, 55%\)$/);
  });
});

describe('hashHue', () => {
  it('never returns a hue inside the 30°-50° reserved amber band', () => {
    const samples = [
      'marketing',
      'security',
      'sales',
      'finance',
      'compliance',
      'legal',
      'design',
      'research',
      'admin',
      'support',
      'analytics',
      'platform',
      'infrastructure',
      'mobile',
      'desktop',
      'ai',
      'ml',
      'data',
      'qa',
      'release',
    ];
    for (const s of samples) {
      const h = hashHue(s);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(h < 30 || h >= 50).toBe(true);
    }
  });
});
