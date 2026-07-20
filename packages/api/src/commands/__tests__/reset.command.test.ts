import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResetCommand } from '../reset.command.js';
import type { SessionCommandContext } from '../session-command.js';

function makeContext(overrides?: Partial<SessionCommandContext>): SessionCommandContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    channelId: 'channel-1',
    senderId: 'sender-1',
    agentDefinitionId: 'agent-def-1',
    ...overrides,
  };
}

describe('ResetCommand', () => {
  const mockSessionManager = {
    deactivate: vi.fn().mockResolvedValue({ id: 'session-1', isActive: false }),
  };
  const mockPrisma = {
    sessionMessage: {
      count: vi.fn().mockResolvedValue(10),
    },
  };
  const mockToolApprovalService = {
    clearSessionMemory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionManager.deactivate.mockResolvedValue({ id: 'session-1', isActive: false });
    mockPrisma.sessionMessage.count.mockResolvedValue(10);
  });

  it('has the correct name and description', () => {
    const cmd = new ResetCommand(
      mockSessionManager as never,
      mockPrisma as never,
      mockToolApprovalService as never,
    );
    expect(cmd.name).toBe('reset');
    expect(cmd.description).toBeDefined();
  });

  it('deactivates the session, clears approval session memory, and returns confirmation', async () => {
    mockPrisma.sessionMessage.count.mockResolvedValue(10);
    const cmd = new ResetCommand(
      mockSessionManager as never,
      mockPrisma as never,
      mockToolApprovalService as never,
    );
    const result = await cmd.execute(makeContext());

    expect(mockSessionManager.deactivate).toHaveBeenCalledWith('session-1');
    expect(mockToolApprovalService.clearSessionMemory).toHaveBeenCalledWith('session-1');
    expect(result.text).toContain('reset');
    expect(result.text).toContain('fresh');
  });

  it('returns early message when session has no messages', async () => {
    mockPrisma.sessionMessage.count.mockResolvedValue(0);
    const cmd = new ResetCommand(
      mockSessionManager as never,
      mockPrisma as never,
      mockToolApprovalService as never,
    );
    const result = await cmd.execute(makeContext());

    expect(mockSessionManager.deactivate).not.toHaveBeenCalled();
    expect(mockToolApprovalService.clearSessionMemory).not.toHaveBeenCalled();
    expect(result.text).toContain('No active conversation');
  });
});
