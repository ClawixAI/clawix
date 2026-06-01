import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { dedentCodeBlocks, reactNodeToText } from '../chat-thread';

describe('dedentCodeBlocks', () => {
  it('leaves a code fence nested in a numbered list untouched', () => {
    const md = [
      '2. Or call the login API:',
      '   ```bash',
      '   curl -X POST https://x/api/auth/login \\',
      '     -H "Content-Type: application/json"',
      '   ```',
      '',
      '3. Copy the `accessToken` from the response',
    ].join('\n');

    // Nested fence markers carry list-indent meaning — dedenting would desync
    // the fence from its body and break the list parse. Must be a no-op.
    expect(dedentCodeBlocks(md)).toBe(md);
  });

  it('dedents a uniformly over-indented top-level fence', () => {
    const md = ['```bash', '    curl -X POST https://x', '    echo done', '```'].join('\n');
    const expected = ['```bash', 'curl -X POST https://x', 'echo done', '```'].join('\n');
    expect(dedentCodeBlocks(md)).toBe(expected);
  });

  it('preserves relative indentation within a top-level fence', () => {
    const md = ['```python', '    def f():', '        return 1', '```'].join('\n');
    const expected = ['```python', 'def f():', '    return 1', '```'].join('\n');
    expect(dedentCodeBlocks(md)).toBe(expected);
  });

  it('leaves an already-flush top-level fence unchanged', () => {
    const md = ['```ts', 'const x = 1;', '```'].join('\n');
    expect(dedentCodeBlocks(md)).toBe(md);
  });
});

describe('reactNodeToText', () => {
  it('extracts text from a rendered <pre><code> tree (ReactMarkdown shape)', () => {
    const tree = createElement(
      'code',
      { className: 'language-bash' },
      'curl -X POST https://x\necho done\n',
    );
    expect(reactNodeToText(tree)).toBe('curl -X POST https://x\necho done\n');
  });

  it('joins mixed string and element children', () => {
    const tree = ['const x = ', createElement('span', null, '1'), ';'];
    expect(reactNodeToText(tree)).toBe('const x = 1;');
  });

  it('returns empty string for null/undefined', () => {
    expect(reactNodeToText(null)).toBe('');
    expect(reactNodeToText(undefined)).toBe('');
  });
});
