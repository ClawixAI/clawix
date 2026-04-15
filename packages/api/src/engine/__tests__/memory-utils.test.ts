import { describe, expect, it } from 'vitest';

import { extractText } from '../memory-utils.js';

describe('extractText', () => {
  it('should extract text from legacy { text: string } format', () => {
    expect(extractText({ text: 'hello' })).toBe('hello');
  });

  it('should return string content directly', () => {
    expect(extractText('plain string')).toBe('plain string');
  });

  it('should JSON.stringify dynamic objects', () => {
    expect(extractText({ key: 'lang', value: 'TS' })).toBe('{"key":"lang","value":"TS"}');
  });

  it('should JSON.stringify arrays', () => {
    expect(extractText(['a', 'b'])).toBe('["a","b"]');
  });
});
