import { describe, expect, it } from 'vitest';

import { formatMarkdownV2 } from '../telegram/telegram.formatter.js';

describe('formatMarkdownV2', () => {
  it('escapes special characters in plain text', () => {
    // These chars must be escaped in MarkdownV2 outside formatting constructs
    expect(formatMarkdownV2('Hello!')).toBe('Hello\\!');
    expect(formatMarkdownV2('Hello.')).toBe('Hello\\.');
    expect(formatMarkdownV2('Hello-world')).toBe('Hello\\-world');
    expect(formatMarkdownV2('Price: $5.00')).toBe('Price: \\$5\\.00');
  });

  it('escapes parentheses and brackets outside formatting', () => {
    expect(formatMarkdownV2('(hello)')).toBe('\\(hello\\)');
    expect(formatMarkdownV2('[brackets]')).toBe('\\[brackets\\]');
    expect(formatMarkdownV2('{braces}')).toBe('\\{braces\\}');
  });

  it('converts **bold** to *bold* (Telegram single asterisk bold)', () => {
    expect(formatMarkdownV2('**bold**')).toBe('*bold*');
    expect(formatMarkdownV2('Hello **world**!')).toBe('Hello *world*\\!');
  });

  it('preserves _italic_ markdown', () => {
    expect(formatMarkdownV2('_italic_')).toBe('_italic_');
    expect(formatMarkdownV2('Hello _world_!')).toBe('Hello _world_\\!');
  });

  it('preserves inline code without escaping content inside', () => {
    // Telegram MarkdownV2: inside backticks, only ` and \ need escaping.
    // Dots, parentheses, etc. are NOT escaped inside code spans.
    expect(formatMarkdownV2('`code`')).toBe('`code`');
    expect(formatMarkdownV2('use `foo.bar()` today')).toBe('use `foo.bar()` today');
  });

  it('preserves code blocks without escaping content inside', () => {
    const input = '```\nfoo.bar();\n```';
    // Inside code blocks, only ` and \ need escaping; dots and parens are safe.
    // The ``` delimiters themselves are preserved verbatim.
    expect(formatMarkdownV2(input)).toBe('```\nfoo.bar();\n```');
  });

  it('escapes dots and dashes in plain text', () => {
    expect(formatMarkdownV2('3.14')).toBe('3\\.14');
    expect(formatMarkdownV2('foo-bar')).toBe('foo\\-bar');
  });

  it('handles empty string', () => {
    expect(formatMarkdownV2('')).toBe('');
  });

  it('handles text with no special characters', () => {
    expect(formatMarkdownV2('hello world')).toBe('hello world');
    expect(formatMarkdownV2('SimpleText123')).toBe('SimpleText123');
  });

  it('handles combined formatting and plain text', () => {
    const input = '**bold** and _italic_ and plain!';
    expect(formatMarkdownV2(input)).toBe('*bold* and _italic_ and plain\\!');
  });

  it('escapes tilde, pipe and other special chars', () => {
    expect(formatMarkdownV2('~strike~')).toBe('\\~strike\\~');
    expect(formatMarkdownV2('a|b')).toBe('a\\|b');
    expect(formatMarkdownV2('a>b')).toBe('a\\>b');
    expect(formatMarkdownV2('#heading')).toBe('\\#heading');
    expect(formatMarkdownV2('a+b')).toBe('a\\+b');
    expect(formatMarkdownV2('a=b')).toBe('a\\=b');
  });

  it('escapes special characters inside bold spans', () => {
    // Telegram MarkdownV2: special chars must be escaped EVERYWHERE except inside
    // code constructs — that includes inside *bold* and _italic_ entities.
    // Without escaping, e.g. `*hk-news-scraper*` causes "can't parse entities".
    expect(formatMarkdownV2('**hk-news-scraper**')).toBe('*hk\\-news\\-scraper*');
    expect(formatMarkdownV2('**v1.0**')).toBe('*v1\\.0*');
    expect(formatMarkdownV2('**done!**')).toBe('*done\\!*');
    expect(formatMarkdownV2('**(parens)**')).toBe('*\\(parens\\)*');
  });

  it('escapes special characters inside italic spans', () => {
    expect(formatMarkdownV2('_hk-news_')).toBe('_hk\\-news_');
    expect(formatMarkdownV2('_v1.0_')).toBe('_v1\\.0_');
  });

  it('formats the cron-job confirmation message correctly', () => {
    // Real-world regression: the original bug report. The bold span
    // **hk-news-scraper** must escape its dashes, otherwise Telegram rejects it.
    const input = 'A one-time cron job **hk-news-scraper** has been scheduled for **14:17 UTC**.';
    expect(formatMarkdownV2(input)).toBe(
      'A one\\-time cron job *hk\\-news\\-scraper* has been scheduled for *14:17 UTC*\\.',
    );
  });
});
