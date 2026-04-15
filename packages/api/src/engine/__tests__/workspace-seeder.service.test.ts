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

  it('should seed MEMORY.md from existing memory items when file does not exist', async () => {
    mockReadFile
      .mockResolvedValueOnce('# Soul' as never)
      .mockResolvedValueOnce('# User' as never);

    await service.seedWorkspace({
      workspacePath: '/data/users/u1/workspace',
      templateVars: {},
      existingMemoryItems: [
        { content: { text: 'Prefers dark mode' }, tags: ['preferences'] },
        { content: 'Raw string note', tags: ['general'] },
        { content: { nested: true }, tags: ['daily:2026-04-11', 'project'] },
      ],
    });

    // MEMORY.md should be written (access rejects by default → file does not exist)
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/data/users/u1/workspace/memory/MEMORY.md',
      expect.stringContaining('# Memory'),
      'utf-8',
    );

    const memoryCall = mockWriteFile.mock.calls.find(
      (c) => c[0] === '/data/users/u1/workspace/memory/MEMORY.md',
    );
    const written = memoryCall![1] as string;
    expect(written).toContain('## General');
    expect(written).toContain('- Raw string note');
    expect(written).toContain('## Preferences');
    expect(written).toContain('- Prefers dark mode');
    expect(written).toContain('## Project');
    expect(written).toContain('- {"nested":true}');
  });

  it('should NOT overwrite existing MEMORY.md', async () => {
    mockReadFile
      .mockResolvedValueOnce('# Soul' as never)
      .mockResolvedValueOnce('# User' as never);

    // SOUL.md missing, USER.md missing, MEMORY.md exists
    mockAccess
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) // SOUL.md
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) // USER.md
      .mockResolvedValueOnce(undefined); // MEMORY.md exists

    await service.seedWorkspace({
      workspacePath: '/data/users/u1/workspace',
      templateVars: {},
      existingMemoryItems: [
        { content: 'Should not be written', tags: ['general'] },
      ],
    });

    // Only SOUL.md and USER.md should be written, NOT MEMORY.md
    const memoryCalls = mockWriteFile.mock.calls.filter(
      (c) => c[0] === '/data/users/u1/workspace/memory/MEMORY.md',
    );
    expect(memoryCalls).toHaveLength(0);
  });

  it('should not write MEMORY.md when no memory items provided', async () => {
    mockReadFile
      .mockResolvedValueOnce('# Soul' as never)
      .mockResolvedValueOnce('# User' as never);

    await service.seedWorkspace({
      workspacePath: '/data/users/u1/workspace',
      templateVars: {},
    });

    const memoryCalls = mockWriteFile.mock.calls.filter(
      (c) => c[0] === '/data/users/u1/workspace/memory/MEMORY.md',
    );
    expect(memoryCalls).toHaveLength(0);
  });
});
