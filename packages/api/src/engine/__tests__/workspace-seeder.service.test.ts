import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@clawix/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clawix/shared')>();
  return {
    ...actual,
    createLogger: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('fs/promises');

import * as fs from 'fs/promises';

import { WorkspaceSeederService } from '../workspace-seeder.service.js';

const mockMkdir = vi.mocked(fs.mkdir);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockAccess = vi.mocked(fs.access);
const mockReadFile = vi.mocked(fs.readFile);

describe('WorkspaceSeederService', () => {
  let service: WorkspaceSeederService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    // access rejects by default (file does not exist)
    mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    service = new WorkspaceSeederService();
  });

  it('should create workspace directory', async () => {
    mockReadFile
      .mockResolvedValueOnce('# Soul template' as never)
      .mockResolvedValueOnce('# User {{ user.name }}' as never);

    await service.seedWorkspace({
      workspacePath: '/data/users/u1/workspace',
      templateVars: { 'user.name': 'Alice' },
    });

    expect(mockMkdir).toHaveBeenCalledWith('/data/users/u1/workspace', { recursive: true });
  });

  it('should write rendered templates to workspace', async () => {
    mockReadFile
      .mockResolvedValueOnce('# Soul template' as never)
      .mockResolvedValueOnce('Hello {{ user.name }}' as never);

    await service.seedWorkspace({
      workspacePath: '/data/users/u1/workspace',
      templateVars: { 'user.name': 'Alice' },
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/data/users/u1/workspace/SOUL.md',
      '# Soul template',
      'utf-8',
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/data/users/u1/workspace/USER.md',
      'Hello Alice',
      'utf-8',
    );
  });

  it('should NOT overwrite existing files', async () => {
    // SOUL.md exists, USER.md does not
    mockAccess
      .mockResolvedValueOnce(undefined) // SOUL.md exists
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })); // USER.md missing

    // SOUL.md is skipped, so only USER.md template is read (one readFile call)
    mockReadFile.mockResolvedValueOnce('Hello {{ user.name }}' as never);

    await service.seedWorkspace({
      workspacePath: '/data/users/u1/workspace',
      templateVars: { 'user.name': 'Alice' },
    });

    // Only USER.md should be written
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/data/users/u1/workspace/USER.md',
      'Hello Alice',
      'utf-8',
    );
  });

  it('should handle missing template files gracefully', async () => {
    mockReadFile.mockRejectedValue(new Error('Template not found'));

    await expect(
      service.seedWorkspace({
        workspacePath: '/data/users/u1/workspace',
        templateVars: {},
      }),
    ).resolves.not.toThrow();

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should create the memory subdirectory', async () => {
    mockReadFile
      .mockResolvedValueOnce('# Soul template' as never)
      .mockResolvedValueOnce('# User {{ user.name }}' as never);

    await service.seedWorkspace({
      workspacePath: '/data/users/u1/workspace',
      templateVars: { 'user.name': 'Alice' },
    });

    expect(mockMkdir).toHaveBeenCalledWith('/data/users/u1/workspace/memory', { recursive: true });
  });
});
