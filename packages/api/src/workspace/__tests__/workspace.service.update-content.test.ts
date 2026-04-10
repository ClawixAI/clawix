// packages/api/src/workspace/__tests__/workspace.service.update-content.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { UserAgentRepository } from '../../db/user-agent.repository.js';
import { WorkspaceService } from '../workspace.service.js';

vi.mock('../scoped-fs.js');
vi.mock('fs/promises');

import { ScopedFs } from '../scoped-fs.js';
import * as fs from 'fs/promises';

const MockedScopedFs = vi.mocked(ScopedFs);

describe('WorkspaceService.updateFileContent', () => {
  let service: WorkspaceService;
  let mockUserAgentRepo: { findByUserId: ReturnType<typeof vi.fn> };
  let mockScopedFs: {
    resolve: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    exists: ReturnType<typeof vi.fn>;
  };

  const userId = 'user-1';
  const workspacePath = 'users/user-1/workspace';
  const basePath = '/data/users/user-1/workspace';

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('WORKSPACE_BASE_PATH', '/data');

    mockScopedFs = {
      resolve: vi.fn((p: string) => {
        const cleaned = p.replace(/^\/+/, '');
        return cleaned === '' ? basePath : `${basePath}/${cleaned}`;
      }),
      stat: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
    };

    MockedScopedFs.mockImplementation(() => mockScopedFs as unknown as ScopedFs);

    mockUserAgentRepo = {
      findByUserId: vi.fn().mockResolvedValue({ workspacePath }),
    };

    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    service = new WorkspaceService(mockUserAgentRepo as unknown as UserAgentRepository);
  });

  const originalModifiedAt = '2026-01-01T00:00:00.000Z';
  const updatedModifiedAt = '2026-01-01T00:01:00.000Z';

  it('writes content and returns updated metadata', async () => {
    mockScopedFs.stat
      .mockResolvedValueOnce({
        isDirectory: () => false,
        mtime: new Date(originalModifiedAt),
        size: 50,
      })
      .mockResolvedValueOnce({
        isDirectory: () => false,
        mtime: new Date(updatedModifiedAt),
        size: 100,
      });

    const result = await service.updateFileContent(
      userId,
      '/config.ts',
      'const x = 1;',
      originalModifiedAt,
    );

    expect(mockScopedFs.writeFile).toHaveBeenCalledWith('/config.ts', 'const x = 1;');
    expect(result).toEqual({
      path: '/config.ts',
      size: 100,
      modifiedAt: updatedModifiedAt,
    });
  });

  it('throws ConflictException when modifiedAt does not match', async () => {
    mockScopedFs.stat.mockResolvedValueOnce({
      isDirectory: () => false,
      mtime: new Date('2026-01-01T00:05:00.000Z'),
      size: 50,
    });

    await expect(
      service.updateFileContent(userId, '/config.ts', 'new content', originalModifiedAt),
    ).rejects.toThrow(ConflictException);
  });

  it('skips conflict check when force is true', async () => {
    mockScopedFs.stat
      .mockResolvedValueOnce({
        isDirectory: () => false,
        mtime: new Date('2026-01-01T00:05:00.000Z'),
        size: 50,
      })
      .mockResolvedValueOnce({
        isDirectory: () => false,
        mtime: new Date(updatedModifiedAt),
        size: 100,
      });

    const result = await service.updateFileContent(
      userId,
      '/config.ts',
      'forced content',
      originalModifiedAt,
      true,
    );

    expect(mockScopedFs.writeFile).toHaveBeenCalledWith('/config.ts', 'forced content');
    expect(result.size).toBe(100);
  });

  it('throws NotFoundException when file does not exist', async () => {
    mockScopedFs.stat.mockRejectedValueOnce(new Error('ENOENT'));

    await expect(
      service.updateFileContent(userId, '/missing.ts', 'content', originalModifiedAt),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException for directory paths', async () => {
    mockScopedFs.stat.mockResolvedValueOnce({
      isDirectory: () => true,
      mtime: new Date(originalModifiedAt),
      size: 0,
    });

    await expect(
      service.updateFileContent(userId, '/src', 'content', originalModifiedAt),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException for binary file types', async () => {
    mockScopedFs.stat.mockResolvedValueOnce({
      isDirectory: () => false,
      mtime: new Date(originalModifiedAt),
      size: 50,
    });

    await expect(
      service.updateFileContent(userId, '/photo.png', 'content', originalModifiedAt),
    ).rejects.toThrow(BadRequestException);
  });
});
