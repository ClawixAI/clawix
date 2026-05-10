import { describe, it, expect } from 'vitest';
import { parseFindOutput } from '../tools/python/files-changed';
import { InstallMutex } from '../tools/python/install-mutex';

describe('parseFindOutput', () => {
  it('parses one path per line', () => {
    expect(parseFindOutput('foo.csv\nplot.png\n')).toEqual(['foo.csv', 'plot.png']);
  });

  it('strips empty lines', () => {
    expect(parseFindOutput('foo.csv\n\nplot.png\n')).toEqual(['foo.csv', 'plot.png']);
  });

  it('returns empty array on empty input', () => {
    expect(parseFindOutput('')).toEqual([]);
  });

  it('preserves nested paths', () => {
    expect(parseFindOutput('sub/dir/file.txt\n')).toEqual(['sub/dir/file.txt']);
  });
});

describe('InstallMutex', () => {
  it('serialises concurrent acquires on the same container', async () => {
    const m = new InstallMutex();
    const order: string[] = [];
    const t1 = m.runExclusive('c1', async () => {
      order.push('t1-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('t1-end');
    });
    const t2 = m.runExclusive('c1', async () => {
      order.push('t2-start');
      order.push('t2-end');
    });
    await Promise.all([t1, t2]);
    expect(order).toEqual(['t1-start', 't1-end', 't2-start', 't2-end']);
  });

  it('does not serialise across different containers', async () => {
    const m = new InstallMutex();
    const order: string[] = [];
    const t1 = m.runExclusive('c1', async () => {
      order.push('t1-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('t1-end');
    });
    const t2 = m.runExclusive('c2', async () => {
      order.push('t2-start');
      order.push('t2-end');
    });
    await Promise.all([t1, t2]);
    // c2 finishes before c1 (independent).
    expect(order.indexOf('t2-end')).toBeLessThan(order.indexOf('t1-end'));
  });
});
