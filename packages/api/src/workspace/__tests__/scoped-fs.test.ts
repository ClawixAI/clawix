// packages/api/src/workspace/__tests__/scoped-fs.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ScopedFs } from '../scoped-fs.js';

describe('ScopedFs', () => {
  let tmpDir: string;
  let scopedFs: ScopedFs;

  beforeEach(async () => {
    const rawTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scopedfs-'));
    // Resolve symlinks (e.g., /var -> /private/var on macOS) for consistent comparison
    tmpDir = fsSync.realpathSync(rawTmpDir);
    scopedFs = new ScopedFs(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('resolve', () => {
    it('should resolve root path to base directory', () => {
      expect(scopedFs.resolve('/')).toBe(tmpDir);
    });

    it('should resolve a simple path within the base', () => {
      expect(scopedFs.resolve('/hello.txt')).toBe(path.join(tmpDir, 'hello.txt'));
    });

    it('should resolve nested paths', () => {
      expect(scopedFs.resolve('/a/b/c.txt')).toBe(path.join(tmpDir, 'a', 'b', 'c.txt'));
    });

    it('should reject path traversal with ..', () => {
      expect(() => scopedFs.resolve('/../etc/passwd')).toThrow('Invalid path');
    });

    it('should reject path traversal with encoded ..', () => {
      expect(() => scopedFs.resolve('/foo/../../etc/passwd')).toThrow('Invalid path');
    });

    it('should reject null bytes', () => {
      expect(() => scopedFs.resolve('/hello\x00.txt')).toThrow('Invalid path');
    });

    it('should reject non-printable characters', () => {
      expect(() => scopedFs.resolve('/hello\x01.txt')).toThrow('Invalid path');
    });

    it('should strip leading slashes', () => {
      expect(scopedFs.resolve('hello.txt')).toBe(path.join(tmpDir, 'hello.txt'));
    });
  });

  describe('writeFile + readFile', () => {
    it('should write and read a file', async () => {
      await scopedFs.writeFile('/test.txt', 'hello world');
      const content = await scopedFs.readFile('/test.txt', 'utf-8');
      expect(content).toBe('hello world');
    });

    it('should create parent directories when writing', async () => {
      await scopedFs.writeFile('/a/b/c.txt', 'nested');
      const content = await scopedFs.readFile('/a/b/c.txt', 'utf-8');
      expect(content).toBe('nested');
    });
  });

  describe('mkdir', () => {
    it('should create a directory', async () => {
      await scopedFs.mkdir('/mydir');
      const stat = await scopedFs.stat('/mydir');
      expect(stat.isDirectory()).toBe(true);
    });

    it('should create nested directories', async () => {
      await scopedFs.mkdir('/a/b/c');
      const stat = await scopedFs.stat('/a/b/c');
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('readdir', () => {
    it('should list directory entries', async () => {
      await scopedFs.writeFile('/file1.txt', 'a');
      await scopedFs.writeFile('/file2.txt', 'b');
      await scopedFs.mkdir('/subdir');
      const entries = await scopedFs.readdir('/');
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['file1.txt', 'file2.txt', 'subdir']);
    });
  });

  describe('stat', () => {
    it('should stat a file', async () => {
      await scopedFs.writeFile('/hello.txt', 'world');
      const stat = await scopedFs.stat('/hello.txt');
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBe(5);
    });

    it('should throw for non-existent path', async () => {
      await expect(scopedFs.stat('/nope.txt')).rejects.toThrow();
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      await scopedFs.writeFile('/exists.txt', '');
      expect(await scopedFs.exists('/exists.txt')).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      expect(await scopedFs.exists('/nope.txt')).toBe(false);
    });
  });

  describe('rename', () => {
    it('should rename a file', async () => {
      await scopedFs.writeFile('/old.txt', 'content');
      await scopedFs.rename('/old.txt', '/new.txt');
      expect(await scopedFs.exists('/old.txt')).toBe(false);
      const content = await scopedFs.readFile('/new.txt', 'utf-8');
      expect(content).toBe('content');
    });

    it('should reject rename to path outside scope', async () => {
      await scopedFs.writeFile('/old.txt', 'content');
      await expect(scopedFs.rename('/old.txt', '/../outside.txt')).rejects.toThrow('Invalid path');
    });
  });

  describe('remove', () => {
    it('should remove a file', async () => {
      await scopedFs.writeFile('/delete-me.txt', 'bye');
      await scopedFs.remove('/delete-me.txt');
      expect(await scopedFs.exists('/delete-me.txt')).toBe(false);
    });

    it('should remove a directory recursively', async () => {
      await scopedFs.writeFile('/dir/a.txt', 'a');
      await scopedFs.writeFile('/dir/b.txt', 'b');
      await scopedFs.remove('/dir');
      expect(await scopedFs.exists('/dir')).toBe(false);
    });

    it('should reject removing root', async () => {
      await expect(scopedFs.remove('/')).rejects.toThrow();
    });
  });

  describe('symlink escape', () => {
    it('should reject symlinks that escape the base path', async () => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret');
      await fs.symlink(outsideDir, path.join(tmpDir, 'escape'));

      await expect(scopedFs.readFile('/escape/secret.txt', 'utf-8')).rejects.toThrow(
        'Invalid path',
      );

      await fs.rm(outsideDir, { recursive: true, force: true });
    });
  });
});
