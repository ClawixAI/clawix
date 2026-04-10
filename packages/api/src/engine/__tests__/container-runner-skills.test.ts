import { describe, it, expect } from 'vitest';
import { buildDockerRunArgs } from '../container-runner.js';
import type { AgentDefinition } from '@clawix/shared';

const mockAgentDef: AgentDefinition = {
  id: 'test-agent',
  name: 'Test Agent',
  description: 'A test agent',
  systemPrompt: 'Be helpful',
  role: 'primary',
  model: 'gpt-4',
  provider: 'openai',
  apiBaseUrl: null,
  skillIds: [],
  maxTokensPerRun: 100_000,
  isActive: true,
  containerConfig: {
    image: 'clawix-agent:latest',
    cpuLimit: '0.5',
    memoryLimit: '256m',
    timeoutSeconds: 300,
    readOnlyRootfs: false,
    allowedMounts: [],
  },
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('buildDockerRunArgs - skill mounts', () => {
  it('adds builtin skills mount as read-only', () => {
    const args = buildDockerRunArgs({
      agentDef: mockAgentDef,
      containerName: 'test-container',
      validatedMounts: [],
      skillMounts: {
        builtinHostPath: '/host/skills/builtin',
        customHostPath: '/host/skills/custom/user1',
      },
    });
    expect(args).toContain('-v');
    const builtinMountIndex = args.indexOf('/host/skills/builtin:/skills/builtin:ro');
    expect(builtinMountIndex).toBeGreaterThan(-1);
  });

  it('adds custom skills mount as read-write', () => {
    const args = buildDockerRunArgs({
      agentDef: mockAgentDef,
      containerName: 'test-container',
      validatedMounts: [],
      skillMounts: {
        builtinHostPath: '/host/skills/builtin',
        customHostPath: '/host/skills/custom/user1',
      },
    });
    const customMountIndex = args.indexOf('/host/skills/custom/user1:/skills/custom');
    expect(customMountIndex).toBeGreaterThan(-1);
  });

  it('omits skill mounts when not provided', () => {
    const args = buildDockerRunArgs({
      agentDef: mockAgentDef,
      containerName: 'test-container',
      validatedMounts: [],
    });
    const skillMountArgs = args.filter((a) => a.includes('/skills/'));
    expect(skillMountArgs).toHaveLength(0);
  });
});
