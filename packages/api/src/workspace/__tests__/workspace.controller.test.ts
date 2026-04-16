// packages/api/src/workspace/__tests__/workspace.controller.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ZodError } from 'zod';

import { WorkspaceController } from '../workspace.controller.js';
import type { WorkspaceService } from '../workspace.service.js';
import type { DirectoryListing, FileContent, FileEntry, DeleteResponse } from '@clawix/shared';

describe('WorkspaceController', () => {
  let controller: WorkspaceController;
  let mockService: {
    listDirectory: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    createEntry: ReturnType<typeof vi.fn>;
    renameEntry: ReturnType<typeof vi.fn>;
    moveEntry: ReturnType<typeof vi.fn>;
    deleteEntry: ReturnType<typeof vi.fn>;
    downloadFile: ReturnType<typeof vi.fn>;
    uploadFile: ReturnType<typeof vi.fn>;
  };

  const mockReq = {
    user: { sub: 'user-1', email: 'test@test.com', role: 'admin' as const, policyName: 'default' },
  };

  const mockListing: DirectoryListing = {
    path: '/',
    parent: null,
    entries: [
      {
        name: 'src',
        path: '/src',
        size: 0,
        modifiedAt: '2026-01-01T00:00:00.000Z',
        isDirectory: true,
        type: 'directory',
      },
      {
        name: 'index.ts',
        path: '/index.ts',
        size: 100,
        modifiedAt: '2026-01-01T00:00:00.000Z',
        isDirectory: false,
        type: 'code',
      },
    ],
  };

  const mockFileContent: FileContent = {
    path: '/index.ts',
    name: 'index.ts',
    size: 100,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    type: 'code',
    content: 'console.log("hello");',
    truncated: false,
  };

  const mockFileEntry: FileEntry = {
    name: 'newfile.ts',
    path: '/newfile.ts',
    size: 0,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    isDirectory: false,
    type: 'code',
  };

  beforeEach(() => {
    mockService = {
      listDirectory: vi.fn(),
      readFile: vi.fn(),
      createEntry: vi.fn(),
      renameEntry: vi.fn(),
      moveEntry: vi.fn(),
      deleteEntry: vi.fn(),
      downloadFile: vi.fn(),
      uploadFile: vi.fn(),
    };
    controller = new WorkspaceController(mockService as unknown as WorkspaceService);
  });

  describe('listFiles', () => {
    it('should list files at root by default', async () => {
      mockService.listDirectory.mockResolvedValue(mockListing);

      const result = await controller.listFiles(mockReq, undefined);

      expect(result).toEqual(mockListing);
      expect(mockService.listDirectory).toHaveBeenCalledWith('user-1', '/');
    });

    it('should list files at specified path', async () => {
      mockService.listDirectory.mockResolvedValue(mockListing);

      await controller.listFiles(mockReq, '/src');

      expect(mockService.listDirectory).toHaveBeenCalledWith('user-1', '/src');
    });

    it('should propagate NotFoundException', async () => {
      mockService.listDirectory.mockRejectedValue(new NotFoundException('Directory not found'));

      await expect(controller.listFiles(mockReq, '/missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFileContent', () => {
    it('should return file content', async () => {
      mockService.readFile.mockResolvedValue(mockFileContent);

      const result = await controller.getFileContent(mockReq, '/index.ts');

      expect(result).toEqual(mockFileContent);
      expect(mockService.readFile).toHaveBeenCalledWith('user-1', '/index.ts');
    });

    it('should throw BadRequestException when path is missing', async () => {
      await expect(controller.getFileContent(mockReq, undefined as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createEntry', () => {
    it('should call service with correct args when body is valid', async () => {
      mockService.createEntry.mockResolvedValue(mockFileEntry);

      const result = await controller.createEntry(mockReq, { path: '/newfile.ts', type: 'file' });

      expect(result).toEqual(mockFileEntry);
      expect(mockService.createEntry).toHaveBeenCalledWith('user-1', '/newfile.ts', 'file');
    });

    it('should call service with directory type', async () => {
      const mockDirEntry: FileEntry = {
        name: 'newdir',
        path: '/newdir',
        size: 0,
        modifiedAt: '2026-01-01T00:00:00.000Z',
        isDirectory: true,
        type: 'directory',
      };
      mockService.createEntry.mockResolvedValue(mockDirEntry);

      const result = await controller.createEntry(mockReq, { path: '/newdir', type: 'directory' });

      expect(result).toEqual(mockDirEntry);
      expect(mockService.createEntry).toHaveBeenCalledWith('user-1', '/newdir', 'directory');
    });

    it('should throw ZodError when body is missing type', async () => {
      await expect(controller.createEntry(mockReq, { path: '/newfile.ts' })).rejects.toThrow(
        ZodError,
      );
    });

    it('should throw ZodError when body is missing path', async () => {
      await expect(controller.createEntry(mockReq, { type: 'file' })).rejects.toThrow(ZodError);
    });

    it('should throw ZodError when type is invalid', async () => {
      await expect(
        controller.createEntry(mockReq, { path: '/newfile.ts', type: 'symlink' }),
      ).rejects.toThrow(ZodError);
    });
  });

  describe('renameEntry', () => {
    it('should call service with correct args', async () => {
      const renamedEntry: FileEntry = { ...mockFileEntry, name: 'renamed.ts', path: '/renamed.ts' };
      mockService.renameEntry.mockResolvedValue(renamedEntry);

      const result = await controller.renameEntry(mockReq, {
        path: '/newfile.ts',
        newName: 'renamed.ts',
      });

      expect(result).toEqual(renamedEntry);
      expect(mockService.renameEntry).toHaveBeenCalledWith('user-1', '/newfile.ts', 'renamed.ts');
    });

    it('should throw ZodError when newName contains slashes', async () => {
      await expect(
        controller.renameEntry(mockReq, { path: '/newfile.ts', newName: 'sub/dir' }),
      ).rejects.toThrow(ZodError);
    });

    it('should throw ZodError when newName contains backslashes', async () => {
      await expect(
        controller.renameEntry(mockReq, { path: '/newfile.ts', newName: 'sub\\dir' }),
      ).rejects.toThrow(ZodError);
    });

    it('should throw ZodError when path is missing', async () => {
      await expect(controller.renameEntry(mockReq, { newName: 'renamed.ts' })).rejects.toThrow(
        ZodError,
      );
    });
  });

  describe('moveEntry', () => {
    it('should call service with correct args', async () => {
      const movedEntry: FileEntry = { ...mockFileEntry, path: '/src/newfile.ts' };
      mockService.moveEntry.mockResolvedValue(movedEntry);

      const result = await controller.moveEntry(mockReq, {
        path: '/newfile.ts',
        destination: '/src',
      });

      expect(result).toEqual(movedEntry);
      expect(mockService.moveEntry).toHaveBeenCalledWith('user-1', '/newfile.ts', '/src');
    });

    it('should throw ZodError when destination is missing', async () => {
      await expect(controller.moveEntry(mockReq, { path: '/newfile.ts' })).rejects.toThrow(
        ZodError,
      );
    });

    it('should throw ZodError when path is empty', async () => {
      await expect(
        controller.moveEntry(mockReq, { path: '', destination: '/src' }),
      ).rejects.toThrow(ZodError);
    });
  });

  describe('deleteEntry', () => {
    it('should call service with correct args', async () => {
      const deleteResponse: DeleteResponse = { path: '/newfile.ts', deleted: true };
      mockService.deleteEntry.mockResolvedValue(deleteResponse);

      const result = await controller.deleteEntry(mockReq, { path: '/newfile.ts' });

      expect(result).toEqual(deleteResponse);
      expect(mockService.deleteEntry).toHaveBeenCalledWith('user-1', '/newfile.ts');
    });

    it('should throw ZodError when path is empty', async () => {
      await expect(controller.deleteEntry(mockReq, { path: '' })).rejects.toThrow(ZodError);
    });

    it('should throw ZodError when body has no path', async () => {
      await expect(controller.deleteEntry(mockReq, {})).rejects.toThrow(ZodError);
    });
  });

  describe('downloadFile', () => {
    it('should call service with correct path and stream the response', async () => {
      const mockStream = { pipe: vi.fn() } as any;
      mockService.downloadFile.mockResolvedValue({
        stream: mockStream,
        filename: 'index.ts',
        contentType: 'text/plain',
        size: 100,
      });

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as any;

      await controller.downloadFile(mockReq, '/index.ts', mockReply);

      expect(mockService.downloadFile).toHaveBeenCalledWith('user-1', '/index.ts');
      expect(mockReply.header).toHaveBeenCalledWith('Content-Type', 'text/plain');
      expect(mockReply.header).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="index.ts"',
      );
      expect(mockReply.header).toHaveBeenCalledWith('Content-Length', 100);
      expect(mockReply.send).toHaveBeenCalledWith(mockStream);
    });

    it('should throw BadRequestException when path is missing', async () => {
      const mockReply = {
        header: vi.fn().mockReturnThis(),
        send: vi.fn().mockResolvedValue(undefined),
      } as any;

      await expect(controller.downloadFile(mockReq, undefined, mockReply)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
