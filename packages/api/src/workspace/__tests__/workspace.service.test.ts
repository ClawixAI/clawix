// packages/api/src/workspace/__tests__/workspace.service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';

import { UserAgentRepository } from '../../db/user-agent.repository.js';
import { WorkspaceService } from '../workspace.service.js';

vi.mock('../scoped-fs.js');
vi.mock('fs/promises');

import { ScopedFs } from '../scoped-fs.js';
import * as fs from 'fs/promises';

const MockedScopedFs = vi.mocked(ScopedFs);

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let mockUserAgentRepo: { findByUserId: ReturnType<typeof vi.fn> };
  let mockScopedFs: {
    resolve: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
    readdir: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    mkdir: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
    createReadStream: ReturnType<typeof vi.fn>;
  };

  const userId = 'user-1';
  const workspacePath = 'users/user-1/workspace';

  beforeEach(() => {
    vi.resetAllMocks();

    mockScopedFs = {
      resolve: vi.fn(),
      stat: vi.fn(),
      readdir: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(false),
      createReadStream: vi.fn(),
    };

    MockedScopedFs.mockImplementation(() => mockScopedFs as unknown as ScopedFs);

    mockUserAgentRepo = {
      findByUserId: vi.fn().mockResolvedValue({
        id: 'ua-1',
        userId,
        workspacePath,
      }),
    };

    service = new WorkspaceService(
      mockUserAgentRepo as unknown as UserAgentRepository,
    );
  });

  describe('detectFileType', () => {
    it('should detect TypeScript files as code', () => {
      expect(WorkspaceService.detectFileType('index.ts')).toBe('code');
    });

    it('should detect markdown files', () => {
      expect(WorkspaceService.detectFileType('README.md')).toBe('markdown');
    });

    it('should detect JSON files', () => {
      expect(WorkspaceService.detectFileType('package.json')).toBe('json');
    });

    it('should detect image files', () => {
      expect(WorkspaceService.detectFileType('photo.png')).toBe('image');
    });

    it('should detect text files', () => {
      expect(WorkspaceService.detectFileType('notes.txt')).toBe('text');
    });

    it('should return unknown for unrecognized extensions', () => {
      expect(WorkspaceService.detectFileType('data.xyz')).toBe('unknown');
    });

    it('should handle files with no extension', () => {
      expect(WorkspaceService.detectFileType('Makefile')).toBe('unknown');
    });
  });

  describe('listDirectory', () => {
    const basePath = '/data/users/user-1/workspace';

    beforeEach(() => {
      vi.stubEnv('WORKSPACE_BASE_PATH', '/data');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockScopedFs.resolve.mockImplementation((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      });
    });

    it('should list directory contents sorted folders-first', async () => {
      mockScopedFs.stat.mockResolvedValueOnce({
        isDirectory: () => true,
      });

      mockScopedFs.readdir.mockResolvedValue([
        { name: 'index.ts', isDirectory: () => false },
        { name: 'src', isDirectory: () => true },
        { name: 'README.md', isDirectory: () => false },
      ]);

      mockScopedFs.stat
        .mockResolvedValueOnce({ size: 100, mtime: new Date('2026-01-01') })
        .mockResolvedValueOnce({ size: 0, mtime: new Date('2026-01-02') })
        .mockResolvedValueOnce({ size: 200, mtime: new Date('2026-01-03') });

      const result = await service.listDirectory(userId, '/');

      expect(result.path).toBe('/');
      expect(result.parent).toBeNull();
      expect(result.entries).toHaveLength(3);
      const [first, second, third] = result.entries;
      expect(first?.name).toBe('src');
      expect(first?.isDirectory).toBe(true);
      expect(second?.name).toBe('index.ts');
      expect(second?.type).toBe('code');
      expect(third?.name).toBe('README.md');
      expect(third?.type).toBe('markdown');
    });

    it('should throw NotFoundException for non-existent directory', async () => {
      mockScopedFs.stat.mockRejectedValue(new Error('ENOENT'));

      await expect(service.listDirectory(userId, '/missing')).rejects.toThrow(NotFoundException);
    });

    it('should return parent path for subdirectories', async () => {
      mockScopedFs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      mockScopedFs.readdir.mockResolvedValue([]);

      const result = await service.listDirectory(userId, '/src/components');

      expect(result.path).toBe('/src/components');
      expect(result.parent).toBe('/src');
    });

    it('should throw NotFoundException when user has no workspace', async () => {
      mockUserAgentRepo.findByUserId.mockResolvedValue(null);

      await expect(service.listDirectory(userId, '/')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when path is not a directory', async () => {
      mockScopedFs.stat.mockResolvedValueOnce({ isDirectory: () => false });

      await expect(service.listDirectory(userId, '/file.txt')).rejects.toThrow(BadRequestException);
    });
  });

  describe('readFile', () => {
    const basePath = '/data/users/user-1/workspace';

    beforeEach(() => {
      vi.stubEnv('WORKSPACE_BASE_PATH', '/data');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockScopedFs.resolve.mockImplementation((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      });
    });

    it('should read text file content', async () => {
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 100,
        mtime: new Date('2026-01-01'),
      });
      mockScopedFs.readFile.mockResolvedValue('hello world');

      const result = await service.readFile(userId, '/test.txt');

      expect(result.content).toBe('hello world');
      expect(result.type).toBe('text');
      expect(result.truncated).toBe(false);
    });

    it('should return null content for binary files', async () => {
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 5000,
        mtime: new Date('2026-01-01'),
      });

      const result = await service.readFile(userId, '/photo.png');

      expect(result.content).toBeNull();
      expect(result.type).toBe('image');
      expect(result.truncated).toBe(false);
    });

    it('should return null content for oversized files', async () => {
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 2 * 1024 * 1024,
        mtime: new Date('2026-01-01'),
      });

      const result = await service.readFile(userId, '/big.txt');

      expect(result.content).toBeNull();
      expect(result.truncated).toBe(true);
    });

    it('should throw NotFoundException for missing files', async () => {
      mockScopedFs.stat.mockRejectedValue(new Error('ENOENT'));

      await expect(service.readFile(userId, '/missing.txt')).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for directories', async () => {
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => true,
      });

      await expect(service.readFile(userId, '/src')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when user has no workspace', async () => {
      mockUserAgentRepo.findByUserId.mockResolvedValue(null);

      await expect(service.readFile(userId, '/file.txt')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createEntry', () => {
    const basePath = '/data/users/user-1/workspace';

    beforeEach(() => {
      vi.stubEnv('WORKSPACE_BASE_PATH', '/data');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockScopedFs.resolve.mockImplementation((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      });
    });

    it('should create an empty file and return FileEntry', async () => {
      mockScopedFs.exists.mockResolvedValue(false);
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 0,
        mtime: new Date('2026-01-01'),
      });

      const result = await service.createEntry(userId, '/notes.txt', 'file');

      expect(mockScopedFs.writeFile).toHaveBeenCalledWith('/notes.txt', '');
      expect(result.name).toBe('notes.txt');
      expect(result.isDirectory).toBe(false);
      expect(result.type).toBe('text');
    });

    it('should create a directory and return FileEntry with isDirectory=true', async () => {
      mockScopedFs.exists.mockResolvedValue(false);
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => true,
        size: 0,
        mtime: new Date('2026-01-01'),
      });

      const result = await service.createEntry(userId, '/src', 'directory');

      expect(mockScopedFs.mkdir).toHaveBeenCalledWith('/src');
      expect(result.isDirectory).toBe(true);
      expect(result.type).toBe('directory');
      expect(result.name).toBe('src');
    });

    it('should throw ConflictException if path already exists', async () => {
      mockScopedFs.exists.mockResolvedValue(true);

      await expect(service.createEntry(userId, '/existing.txt', 'file')).rejects.toThrow(ConflictException);
      expect(mockScopedFs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('renameEntry', () => {
    const basePath = '/data/users/user-1/workspace';

    beforeEach(() => {
      vi.stubEnv('WORKSPACE_BASE_PATH', '/data');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockScopedFs.resolve.mockImplementation((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      });
    });

    it('should rename a file and return FileEntry with new name', async () => {
      // source exists, target does not
      mockScopedFs.exists
        .mockResolvedValueOnce(true)   // source exists check
        .mockResolvedValueOnce(false); // target does not exist
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 100,
        mtime: new Date('2026-01-01'),
      });

      const result = await service.renameEntry(userId, '/old.txt', 'new.txt');

      expect(mockScopedFs.rename).toHaveBeenCalled();
      expect(result.name).toBe('new.txt');
    });

    it('should throw ConflictException if target name already exists', async () => {
      mockScopedFs.exists
        .mockResolvedValueOnce(true)  // source exists
        .mockResolvedValueOnce(true); // target already exists

      await expect(service.renameEntry(userId, '/old.txt', 'existing.txt')).rejects.toThrow(ConflictException);
      expect(mockScopedFs.rename).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if source does not exist', async () => {
      mockScopedFs.exists.mockResolvedValueOnce(false); // source does not exist

      await expect(service.renameEntry(userId, '/missing.txt', 'new.txt')).rejects.toThrow(NotFoundException);
      expect(mockScopedFs.rename).not.toHaveBeenCalled();
    });
  });

  describe('moveEntry', () => {
    const basePath = '/data/users/user-1/workspace';

    beforeEach(() => {
      vi.stubEnv('WORKSPACE_BASE_PATH', '/data');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockScopedFs.resolve.mockImplementation((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      });
    });

    it('should move file to another directory and return FileEntry with new path', async () => {
      mockScopedFs.exists
        .mockResolvedValueOnce(true)  // source exists
        .mockResolvedValueOnce(false); // no conflict at destination
      mockScopedFs.stat
        .mockResolvedValueOnce({ isDirectory: () => true, size: 0, mtime: new Date('2026-01-01') }) // dest stat
        .mockResolvedValueOnce({ isDirectory: () => false, size: 50, mtime: new Date('2026-01-01') }); // new location stat

      const result = await service.moveEntry(userId, '/file.txt', '/archive');

      expect(mockScopedFs.rename).toHaveBeenCalled();
      expect(result.name).toBe('file.txt');
      expect(result.path).toBe('/archive/file.txt');
    });

    it('should throw NotFoundException if destination directory does not exist', async () => {
      mockScopedFs.exists.mockResolvedValueOnce(true); // source exists
      mockScopedFs.stat.mockRejectedValue(new Error('ENOENT')); // destination stat fails

      await expect(service.moveEntry(userId, '/file.txt', '/nonexistent')).rejects.toThrow(NotFoundException);
      expect(mockScopedFs.rename).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if same-name file exists at destination', async () => {
      mockScopedFs.exists
        .mockResolvedValueOnce(true)  // source exists
        .mockResolvedValueOnce(true); // conflict at destination
      mockScopedFs.stat.mockResolvedValueOnce({ isDirectory: () => true, size: 0, mtime: new Date('2026-01-01') }); // dest is directory

      await expect(service.moveEntry(userId, '/file.txt', '/archive')).rejects.toThrow(ConflictException);
      expect(mockScopedFs.rename).not.toHaveBeenCalled();
    });
  });

  describe('deleteEntry', () => {
    const basePath = '/data/users/user-1/workspace';

    beforeEach(() => {
      vi.stubEnv('WORKSPACE_BASE_PATH', '/data');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockScopedFs.resolve.mockImplementation((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      });
    });

    it('should delete a file and return { path, deleted: true }', async () => {
      mockScopedFs.exists.mockResolvedValue(true);

      const result = await service.deleteEntry(userId, '/file.txt');

      expect(mockScopedFs.remove).toHaveBeenCalledWith('/file.txt');
      expect(result).toEqual({ path: '/file.txt', deleted: true });
    });

    it('should delete a non-empty directory recursively', async () => {
      mockScopedFs.exists.mockResolvedValue(true);

      const result = await service.deleteEntry(userId, '/src');

      expect(mockScopedFs.remove).toHaveBeenCalledWith('/src');
      expect(result).toEqual({ path: '/src', deleted: true });
    });

    it('should throw NotFoundException if path does not exist', async () => {
      mockScopedFs.exists.mockResolvedValue(false);

      await expect(service.deleteEntry(userId, '/missing.txt')).rejects.toThrow(NotFoundException);
      expect(mockScopedFs.remove).not.toHaveBeenCalled();
    });
  });

  describe('downloadFile', () => {
    const basePath = '/data/users/user-1/workspace';

    beforeEach(() => {
      vi.stubEnv('WORKSPACE_BASE_PATH', '/data');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockScopedFs.resolve.mockImplementation((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      });
    });

    it('should return stream and metadata for a file', async () => {
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 1024,
        mtime: new Date('2026-01-01'),
      });
      const mockStream = new Readable({ read() {} });
      mockScopedFs.createReadStream.mockReturnValue(mockStream);

      const result = await service.downloadFile(userId, '/report.pdf');

      expect(result.filename).toBe('report.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.size).toBe(1024);
      expect(result.stream).toBe(mockStream);
    });

    it('should throw BadRequestException for a directory', async () => {
      mockScopedFs.stat.mockResolvedValue({
        isDirectory: () => true,
        size: 0,
        mtime: new Date('2026-01-01'),
      });

      await expect(service.downloadFile(userId, '/src')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent file', async () => {
      mockScopedFs.stat.mockRejectedValue(new Error('ENOENT'));

      await expect(service.downloadFile(userId, '/missing.txt')).rejects.toThrow(NotFoundException);
    });
  });

  describe('uploadFile', () => {
    const basePath = '/data/users/user-1/workspace';

    beforeEach(() => {
      vi.stubEnv('WORKSPACE_BASE_PATH', '/data');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      mockScopedFs.resolve.mockImplementation((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      });
    });

    it('should upload file to workspace and return FileEntry', async () => {
      const data = Buffer.from('hello world');
      mockScopedFs.stat
        .mockResolvedValueOnce({ isDirectory: () => true, size: 0, mtime: new Date('2026-01-01') }) // dir stat
        .mockResolvedValueOnce({ isDirectory: () => false, size: data.byteLength, mtime: new Date('2026-01-01') }); // file stat after write
      mockScopedFs.exists.mockResolvedValue(false); // no conflict

      const result = await service.uploadFile(userId, '/docs', 'hello.txt', data);

      expect(mockScopedFs.writeFile).toHaveBeenCalled();
      expect(result.name).toBe('hello.txt');
      expect(result.isDirectory).toBe(false);
      expect(result.type).toBe('text');
    });

    it('should throw ConflictException if file exists and overwrite is false', async () => {
      const data = Buffer.from('data');
      mockScopedFs.stat.mockResolvedValueOnce({ isDirectory: () => true, size: 0, mtime: new Date() }); // dir ok
      mockScopedFs.exists.mockResolvedValue(true); // file exists

      await expect(service.uploadFile(userId, '/docs', 'existing.txt', data, false)).rejects.toThrow(ConflictException);
      expect(mockScopedFs.writeFile).not.toHaveBeenCalled();
    });

    it('should overwrite existing file when overwrite=true', async () => {
      const data = Buffer.from('new content');
      mockScopedFs.stat
        .mockResolvedValueOnce({ isDirectory: () => true, size: 0, mtime: new Date() })  // dir stat
        .mockResolvedValueOnce({ isDirectory: () => false, size: data.byteLength, mtime: new Date() }); // file stat
      mockScopedFs.exists.mockResolvedValue(true); // file exists but overwrite=true

      const result = await service.uploadFile(userId, '/docs', 'existing.txt', data, true);

      expect(mockScopedFs.writeFile).toHaveBeenCalled();
      expect(result.name).toBe('existing.txt');
    });
  });
});
