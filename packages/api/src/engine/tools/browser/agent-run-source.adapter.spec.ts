import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '@clawix/shared';

import { AgentRunSourceAdapter } from './agent-run-source.adapter.js';
import type { AgentRunRepository } from '../../../db/agent-run.repository.js';

const makeRun = (status: string) =>
  ({ id: 'r1', status }) as unknown as Awaited<ReturnType<AgentRunRepository['findById']>>;

function buildRepo(impl: (id: string) => Promise<unknown>) {
  return { findById: vi.fn(impl) } as unknown as AgentRunRepository;
}

describe('AgentRunSourceAdapter', () => {
  it('reports running for active statuses', async () => {
    const repo = buildRepo(async () => makeRun('running'));
    const adapter = new AgentRunSourceAdapter(repo);
    await expect(adapter.isRunning('r1')).resolves.toBe(true);
  });

  it('reports running for idle status', async () => {
    const repo = buildRepo(async () => makeRun('idle'));
    const adapter = new AgentRunSourceAdapter(repo);
    await expect(adapter.isRunning('r1')).resolves.toBe(true);
  });

  it('reports stopped for completed runs', async () => {
    const repo = buildRepo(async () => makeRun('completed'));
    const adapter = new AgentRunSourceAdapter(repo);
    await expect(adapter.isRunning('r1')).resolves.toBe(false);
  });

  it('reports stopped when the run row no longer exists (NotFoundError)', async () => {
    const repo = buildRepo(async () => {
      throw new NotFoundError('AgentRun', 'r1');
    });
    const adapter = new AgentRunSourceAdapter(repo);
    await expect(adapter.isRunning('r1')).resolves.toBe(false);
  });

  it('propagates non-NotFoundError exceptions so the sweep can skip the run', async () => {
    // A transient DB error must NOT be interpreted as "stopped" — that would
    // cause the orphan sweep to force-release every healthy session during a
    // brief Postgres hiccup.
    const repo = buildRepo(async () => {
      throw new Error('connection terminated unexpectedly');
    });
    const adapter = new AgentRunSourceAdapter(repo);
    await expect(adapter.isRunning('r1')).rejects.toThrow(/connection terminated/);
  });
});
