// packages/api/src/workspace/__tests__/workspace.controller.update-content.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ZodError } from 'zod';

import { WorkspaceController } from '../workspace.controller.js';
import type { WorkspaceService } from '../workspace.service.js';

describe('WorkspaceController.updateFileContent', () => {
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
    updateFileContent: ReturnType<typeof vi.fn>;
  };

  const mockReq = { user: { sub: 'user-1', email: 'test@test.com', role: 'admin' as const, policyName: 'default' } };

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
      updateFileContent: vi.fn(),
    };
    controller = new WorkspaceController(mockService as unknown as WorkspaceService);
  });

  it('calls service with parsed body and returns result', async () => {
    const response = { path: '/config.ts', size: 100, modifiedAt: '2026-01-01T00:01:00.000Z' };
    mockService.updateFileContent.mockResolvedValue(response);

    const result = await controller.updateFileContent(mockReq, {
      path: '/config.ts',
      content: 'const x = 1;',
      expectedModifiedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(mockService.updateFileContent).toHaveBeenCalledWith(
      'user-1',
      '/config.ts',
      'const x = 1;',
      '2026-01-01T00:00:00.000Z',
      undefined,
    );
    expect(result).toEqual(response);
  });

  it('passes force flag to service', async () => {
    const response = { path: '/config.ts', size: 100, modifiedAt: '2026-01-01T00:01:00.000Z' };
    mockService.updateFileContent.mockResolvedValue(response);

    await controller.updateFileContent(mockReq, {
      path: '/config.ts',
      content: 'forced',
      expectedModifiedAt: '2026-01-01T00:00:00.000Z',
      force: true,
    });

    expect(mockService.updateFileContent).toHaveBeenCalledWith(
      'user-1',
      '/config.ts',
      'forced',
      '2026-01-01T00:00:00.000Z',
      true,
    );
  });

  it('throws ZodError for missing path', async () => {
    await expect(
      controller.updateFileContent(mockReq, {
        content: 'hello',
        expectedModifiedAt: '2026-01-01T00:00:00.000Z',
      } as never),
    ).rejects.toThrow(ZodError);
  });

  it('throws ZodError for invalid datetime format', async () => {
    await expect(
      controller.updateFileContent(mockReq, {
        path: '/file.ts',
        content: 'hello',
        expectedModifiedAt: 'not-a-date',
      }),
    ).rejects.toThrow(ZodError);
  });

  it('propagates ConflictException from service', async () => {
    mockService.updateFileContent.mockRejectedValue(
      new ConflictException('File was modified since last read'),
    );

    await expect(
      controller.updateFileContent(mockReq, {
        path: '/file.ts',
        content: 'hello',
        expectedModifiedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
