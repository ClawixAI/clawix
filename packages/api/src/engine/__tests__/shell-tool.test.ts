import { describe, it, expect, vi } from 'vitest';

import { createShellTool } from '../tools/shell.js';
import type { IContainerRunner } from '../container-runner.js';

describe('shell tool', () => {
  it('forwards ctx.abortSignal to containerRunner.exec', async () => {
    const seenOptions: ({ signal?: AbortSignal } | undefined)[] = [];
    const fakeRunner = {
      exec: vi.fn(
        async (
          _id: string,
          _cmd: readonly string[],
          options?: { signal?: AbortSignal; [key: string]: unknown },
        ) => {
          seenOptions.push(options);
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        },
      ),
    } as unknown as IContainerRunner;

    const tool = createShellTool('container-1', fakeRunner);
    const controller = new AbortController();

    await tool.execute({ command: 'echo hi' }, { abortSignal: controller.signal });

    expect(seenOptions[0]).toMatchObject({ signal: controller.signal });
  });

  it('does not pass signal when ctx is undefined', async () => {
    const seenOptions: ({ signal?: AbortSignal } | undefined)[] = [];
    const fakeRunner = {
      exec: vi.fn(
        async (
          _id: string,
          _cmd: readonly string[],
          options?: { signal?: AbortSignal; [key: string]: unknown },
        ) => {
          seenOptions.push(options);
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        },
      ),
    } as unknown as IContainerRunner;

    const tool = createShellTool('container-2', fakeRunner);

    await tool.execute({ command: 'echo hi' });

    expect(seenOptions[0]).not.toHaveProperty('signal');
  });

  it('does not pass signal when ctx.abortSignal is undefined', async () => {
    const seenOptions: ({ signal?: AbortSignal } | undefined)[] = [];
    const fakeRunner = {
      exec: vi.fn(
        async (
          _id: string,
          _cmd: readonly string[],
          options?: { signal?: AbortSignal; [key: string]: unknown },
        ) => {
          seenOptions.push(options);
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        },
      ),
    } as unknown as IContainerRunner;

    const tool = createShellTool('container-3', fakeRunner);

    await tool.execute({ command: 'echo hi' }, {});

    expect(seenOptions[0]).not.toHaveProperty('signal');
  });
});
