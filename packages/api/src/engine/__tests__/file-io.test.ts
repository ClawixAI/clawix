import { describe, expect, it, vi } from 'vitest';

import type { IContainerRunner } from '../container-runner.js';
import {
  validateContainerPath,
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createListDirectoryTool,
} from '../tools/file-io.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockContainerRunner(execResult: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): IContainerRunner {
  return {
    start: vi.fn(),
    exec: vi.fn().mockResolvedValue(execResult),
    stop: vi.fn(),
  };
}

const CONTAINER_ID = 'container-test-1';

// ---------------------------------------------------------------------------
// Task 1: validateContainerPath
// ---------------------------------------------------------------------------

describe('validateContainerPath', () => {
  it('accepts /workspace', () => {
    expect(validateContainerPath('/workspace')).toBe('/workspace');
  });

  it('accepts nested file path', () => {
    expect(validateContainerPath('/workspace/foo.txt')).toBe('/workspace/foo.txt');
  });

  it('accepts deeply nested path', () => {
    expect(validateContainerPath('/workspace/a/b/c/d.ts')).toBe('/workspace/a/b/c/d.ts');
  });

  it('normalizes dot segments', () => {
    expect(validateContainerPath('/workspace/./foo')).toBe('/workspace/foo');
  });

  it('accepts trailing slash', () => {
    expect(validateContainerPath('/workspace/')).toBe('/workspace/');
  });

  it('blocks traversal paths', () => {
    expect(() => validateContainerPath('../../etc/passwd')).toThrow(
      'outside the allowed directories',
    );
  });

  it('blocks workspace escape via parent traversal', () => {
    expect(() => validateContainerPath('/workspace/../etc/shadow')).toThrow(
      'outside the allowed directories',
    );
  });

  it('blocks paths outside workspace', () => {
    expect(() => validateContainerPath('/tmp/evil')).toThrow('outside the allowed directories');
  });

  it('blocks prefix trick (/workspacefoo)', () => {
    expect(() => validateContainerPath('/workspacefoo')).toThrow('outside the allowed directories');
  });

  it('blocks empty string', () => {
    expect(() => validateContainerPath('')).toThrow('outside the allowed directories');
  });

  it('allows /skills root', () => {
    expect(validateContainerPath('/skills')).toBe('/skills');
  });

  it('allows /skills/builtin paths', () => {
    expect(validateContainerPath('/skills/builtin/skill-creator/SKILL.md')).toBe(
      '/skills/builtin/skill-creator/SKILL.md',
    );
  });

  it('allows /skills/custom paths', () => {
    expect(validateContainerPath('/skills/custom/my-skill/SKILL.md')).toBe(
      '/skills/custom/my-skill/SKILL.md',
    );
  });

  it('blocks /skills escape via traversal', () => {
    expect(() => validateContainerPath('/skills/../etc/passwd')).toThrow(
      'outside the allowed directories',
    );
  });
});

// ---------------------------------------------------------------------------
// Task 2: read_file tool
// ---------------------------------------------------------------------------

describe('read_file tool', () => {
  it('returns file content on success', async () => {
    const runner = mockContainerRunner({ exitCode: 0, stdout: 'hello world', stderr: '' });
    const tool = createReadFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/workspace/hello.txt' });

    expect(result.isError).toBe(false);
    expect(result.output).toBe('hello world');
    expect(runner.exec).toHaveBeenCalledWith(CONTAINER_ID, ['cat', '/workspace/hello.txt']);
  });

  it('returns error with combined stdout/stderr on failure', async () => {
    const runner = mockContainerRunner({
      exitCode: 1,
      stdout: 'out-data',
      stderr: 'err-data',
    });
    const tool = createReadFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/workspace/missing.txt' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('out-data');
    expect(result.output).toContain('err-data');
  });

  it('returns fallback error message when stdout and stderr are both empty', async () => {
    const runner = mockContainerRunner({ exitCode: 1, stdout: '', stderr: '' });
    const tool = createReadFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/workspace/empty.txt' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Failed to read file');
  });

  it('returns error for path traversal without calling exec', async () => {
    const runner = mockContainerRunner({ exitCode: 0, stdout: '', stderr: '' });
    const tool = createReadFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/etc/passwd' });

    expect(result.isError).toBe(true);
    expect(runner.exec).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task 3: write_file tool
// ---------------------------------------------------------------------------

describe('write_file tool', () => {
  it('calls mkdir -p then tee in order and returns success', async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // mkdir
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // tee

    const runner: IContainerRunner = { start: vi.fn(), exec: execMock, stop: vi.fn() };
    const tool = createWriteFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/workspace/sub/file.txt', content: 'hello' });

    expect(result.isError).toBe(false);
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(execMock).toHaveBeenNthCalledWith(1, CONTAINER_ID, ['mkdir', '-p', '/workspace/sub']);
    expect(execMock).toHaveBeenNthCalledWith(2, CONTAINER_ID, ['tee', '/workspace/sub/file.txt'], {
      stdin: 'hello',
    });
  });

  it('returns error and does not call tee when mkdir fails', async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'permission denied' });

    const runner: IContainerRunner = { start: vi.fn(), exec: execMock, stop: vi.fn() };
    const tool = createWriteFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/workspace/sub/file.txt', content: 'hello' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('permission denied');
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('returns error when tee fails after successful mkdir', async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // mkdir ok
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'disk full' }); // tee fail

    const runner: IContainerRunner = { start: vi.fn(), exec: execMock, stop: vi.fn() };
    const tool = createWriteFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/workspace/file.txt', content: 'data' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('disk full');
  });

  it('returns error for path traversal without calling exec', async () => {
    const runner = mockContainerRunner({ exitCode: 0, stdout: '', stderr: '' });
    const tool = createWriteFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/tmp/evil.txt', content: 'bad' });

    expect(result.isError).toBe(true);
    expect(runner.exec).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task 4: edit_file tool
// ---------------------------------------------------------------------------

describe('edit_file tool', () => {
  it('replaces exactly one occurrence and writes updated content', async () => {
    const originalContent = 'hello world';
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: originalContent, stderr: '' }) // cat
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // mkdir
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // tee

    const runner: IContainerRunner = { start: vi.fn(), exec: execMock, stop: vi.fn() };
    const tool = createEditFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({
      path: '/workspace/file.txt',
      old_text: 'world',
      new_text: 'vitest',
    });

    expect(result.isError).toBe(false);
    // Verify tee was called with updated content
    expect(execMock).toHaveBeenCalledTimes(3);
    const teeCall = execMock.mock.calls[2]!;
    expect(teeCall[2]).toEqual({ stdin: 'hello vitest' });
  });

  it('returns "not found" error when old_text has zero occurrences', async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'some other content', stderr: '' }); // cat

    const runner: IContainerRunner = { start: vi.fn(), exec: execMock, stop: vi.fn() };
    const tool = createEditFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({
      path: '/workspace/file.txt',
      old_text: 'not present',
      new_text: 'replacement',
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('not found');
  });

  it('returns error when old_text appears more than once', async () => {
    const execMock = vi.fn().mockResolvedValueOnce({ exitCode: 0, stdout: 'aaa', stderr: '' }); // 'a' appears 3 times

    const runner: IContainerRunner = { start: vi.fn(), exec: execMock, stop: vi.fn() };
    const tool = createEditFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({
      path: '/workspace/file.txt',
      old_text: 'a',
      new_text: 'b',
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('3 times');
  });

  it('returns error without attempting replacement when read fails', async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'no such file' }); // cat fails

    const runner: IContainerRunner = { start: vi.fn(), exec: execMock, stop: vi.fn() };
    const tool = createEditFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({
      path: '/workspace/file.txt',
      old_text: 'anything',
      new_text: 'replacement',
    });

    expect(result.isError).toBe(true);
    expect(execMock).toHaveBeenCalledTimes(1); // only cat, no mkdir/tee
  });

  it('returns error for path traversal without calling exec', async () => {
    const runner = mockContainerRunner({ exitCode: 0, stdout: '', stderr: '' });
    const tool = createEditFileTool(CONTAINER_ID, runner);

    const result = await tool.execute({
      path: '/etc/hosts',
      old_text: 'localhost',
      new_text: 'evil',
    });

    expect(result.isError).toBe(true);
    expect(runner.exec).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task 5: list_directory tool
// ---------------------------------------------------------------------------

describe('list_directory tool', () => {
  it('returns ls -la output on success', async () => {
    const lsOutput = 'total 8\ndrwxr-xr-x 2 root root 4096 Mar 15 12:00 .\n';
    const runner = mockContainerRunner({ exitCode: 0, stdout: lsOutput, stderr: '' });
    const tool = createListDirectoryTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/workspace' });

    expect(result.isError).toBe(false);
    expect(result.output).toBe(lsOutput);
    expect(runner.exec).toHaveBeenCalledWith(CONTAINER_ID, ['ls', '-la', '/workspace']);
  });

  it('defaults to /workspace when no path is provided', async () => {
    const runner = mockContainerRunner({ exitCode: 0, stdout: 'listing', stderr: '' });
    const tool = createListDirectoryTool(CONTAINER_ID, runner);

    const result = await tool.execute({});

    expect(result.isError).toBe(false);
    expect(runner.exec).toHaveBeenCalledWith(CONTAINER_ID, ['ls', '-la', '/workspace']);
  });

  it('returns error when ls fails', async () => {
    const runner = mockContainerRunner({ exitCode: 2, stdout: '', stderr: 'No such directory' });
    const tool = createListDirectoryTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/workspace/nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('No such directory');
  });

  it('returns error for path outside workspace without calling exec', async () => {
    const runner = mockContainerRunner({ exitCode: 0, stdout: '', stderr: '' });
    const tool = createListDirectoryTool(CONTAINER_ID, runner);

    const result = await tool.execute({ path: '/etc' });

    expect(result.isError).toBe(true);
    expect(runner.exec).not.toHaveBeenCalled();
  });
});
