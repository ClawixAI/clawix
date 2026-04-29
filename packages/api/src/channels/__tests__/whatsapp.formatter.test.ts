import { describe, expect, it } from 'vitest';

import { formatWhatsAppText } from '../whatsapp/whatsapp.formatter.js';

describe('formatWhatsAppText', () => {
  it('passes through plain text unchanged', () => {
    expect(formatWhatsAppText('hello world')).toBe('hello world');
    expect(formatWhatsAppText('Price: $5.00')).toBe('Price: $5.00');
  });

  it('converts **bold** to *bold*', () => {
    expect(formatWhatsAppText('**bold**')).toBe('*bold*');
    expect(formatWhatsAppText('Hello **world**!')).toBe('Hello *world*!');
  });

  it('converts *italic* (single asterisks not part of **) to _italic_', () => {
    expect(formatWhatsAppText('*italic*')).toBe('_italic_');
    expect(formatWhatsAppText('Hello *world*!')).toBe('Hello _world_!');
  });

  it('does not corrupt bold delimiters when both bold and italic are present', () => {
    // The order matters: ** must be processed before single *.
    expect(formatWhatsAppText('**bold** and *italic*')).toBe('*bold* and _italic_');
  });

  it('converts ~~strike~~ to ~strike~', () => {
    expect(formatWhatsAppText('~~strike~~')).toBe('~strike~');
  });

  it('preserves inline code spans untouched', () => {
    expect(formatWhatsAppText('use `foo.bar()` today')).toBe('use `foo.bar()` today');
    // Bold/italic syntax INSIDE a code span must not be transformed.
    expect(formatWhatsAppText('`**not bold**`')).toBe('`**not bold**`');
  });

  it('preserves fenced code blocks untouched', () => {
    const input = '```ts\nconst x = **1**;\n```';
    // Even if the body contains ** the formatter must not touch it.
    expect(formatWhatsAppText(input)).toBe('```ts\nconst x = **1**;\n```');
  });

  it('converts headers to *bold* lines (WhatsApp has no header support)', () => {
    expect(formatWhatsAppText('# Title')).toBe('*Title*');
    expect(formatWhatsAppText('## Subhead')).toBe('*Subhead*');
    expect(formatWhatsAppText('### Tertiary')).toBe('*Tertiary*');
  });

  it('converts markdown links to "text (url)"', () => {
    expect(formatWhatsAppText('see [docs](https://example.com)')).toBe(
      'see docs (https://example.com)',
    );
  });

  it('leaves bullet and numbered lists unchanged', () => {
    expect(formatWhatsAppText('- one\n- two')).toBe('- one\n- two');
    expect(formatWhatsAppText('1. first\n2. second')).toBe('1. first\n2. second');
  });

  it('handles empty string', () => {
    expect(formatWhatsAppText('')).toBe('');
  });

  it('handles a multi-construct paragraph end-to-end', () => {
    const input = '## Steps\n1. Run **build**\n2. See [docs](https://x.io)\n```\nrun()\n```';
    expect(formatWhatsAppText(input)).toBe(
      '*Steps*\n1. Run *build*\n2. See docs (https://x.io)\n```\nrun()\n```',
    );
  });

  it('strips **bold** markers inside headers', () => {
    expect(formatWhatsAppText('# Title **with bold**')).toBe('*Title with bold*');
    expect(formatWhatsAppText('## Sub **emphasis**')).toBe('*Sub emphasis*');
  });

  it('does not corrupt text that contains the internal placeholder token', () => {
    // The old printable-ASCII placeholder strings should be safely treated as plain text now.
    expect(formatWhatsAppText('WAFMTC 0 WAFMTC')).toBe('WAFMTC 0 WAFMTC');
    expect(formatWhatsAppText('WAFMTB 1 WAFMTB')).toBe('WAFMTB 1 WAFMTB');
  });
});
