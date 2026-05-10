import { vi } from 'vitest';

import type { RunContext, VisionConfig } from '../tools/browser-navigate.js';

export interface StubOverrides {
  runId?: string;
  userId?: string;
  activeModel?: string;
  toolConfig?: RunContext['toolConfig'];
  policy?: RunContext['policy'];
  vision?: VisionConfig;
}

export function stubRunContext(overrides: StubOverrides = {}): RunContext {
  return {
    runId: overrides.runId ?? 'r',
    userId: overrides.userId ?? 'u',
    activeModel: overrides.activeModel ?? 'test-model',
    toolConfig: overrides.toolConfig ?? {},
    policy: overrides.policy ?? { allowBrowserCdp: false },
    vision: overrides.vision ?? {
      available: true,
      capable: false,
      providerLabel: 'test-provider',
      modelLabel: 'test-model',
      call: vi.fn(async () => 'stubbed-vision'),
    },
  };
}
