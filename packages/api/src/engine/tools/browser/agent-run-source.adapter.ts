/**
 * AgentRunSourceAdapter — bridges the AgentRunRepository to the
 * BrowserSessionManager.AgentRunSource interface used by the orphan-sweep.
 *
 * A run is considered "still running" if its status is 'running' or 'idle';
 * completed/failed runs are treated as stopped so orphan sessions are released.
 *
 * Error handling: only `NotFoundError` is interpreted as "stopped" (the run row
 * was deleted). All other errors — DB connectivity hiccups, unexpected query
 * failures — propagate so the sweep loop can skip the run rather than
 * force-releasing healthy sessions during a transient infrastructure blip
 * (review issue #7).
 */

import { Injectable } from '@nestjs/common';

import { NotFoundError } from '@clawix/shared';

import type { AgentRunSource } from './browser-session-manager.js';
import { AgentRunRepository } from '../../../db/agent-run.repository.js';

@Injectable()
export class AgentRunSourceAdapter implements AgentRunSource {
  constructor(private readonly repo: AgentRunRepository) {}

  async isRunning(runId: string): Promise<boolean> {
    let run: Awaited<ReturnType<AgentRunRepository['findById']>>;
    try {
      run = await this.repo.findById(runId);
    } catch (err) {
      if (err instanceof NotFoundError) return false;
      throw err;
    }
    return run.status === 'running' || run.status === 'idle';
  }
}
