import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ------------------------------------------------------------------ //
//  Module mocks — must be hoisted before imports                      //
// ------------------------------------------------------------------ //

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

vi.mock('../providers/provider-factory.js', () => ({
  createProvider: vi.fn(),
}));

vi.mock('../providers/api-key-resolver.js', () => ({
  resolveApiKey: vi.fn().mockReturnValue('test-api-key'),
}));

// ------------------------------------------------------------------ //
//  Imports after mocks                                                //
// ------------------------------------------------------------------ //

import {
  MemoryConsolidationService,
  normalizeSaveMemoryArgs,
  isToolChoiceUnsupported,
} from '../memory-consolidation.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { TokenCounterService } from '../token-counter.service.js';
import type { IContainerRunner } from '../container-runner.js';
import { createProvider } from '../providers/provider-factory.js';

// ------------------------------------------------------------------ //
//  Fixtures                                                           //
// ------------------------------------------------------------------ //

function makeSessionMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello world',
    toolCallId: null,
    toolCalls: null,
    ordering: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// function makeSummaryMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
//   return makeSessionMessage({
//     id: 'summary-1',
//     role: 'system',
//     content: '[MEMORY SUMMARY]\nPrevious context: user asked about TypeScript.',
//     ordering: 0,
//     ...overrides,
//   });
// }

/** Build a successful LLMResponse with a save_memory tool call. */
function makeSaveMemoryResponse(
  history_entry = 'User discussed TypeScript setup',
  memory_update = 'Session context: TypeScript and Node.js project setup',
) {
  return {
    content: null,
    finishReason: 'tool_use' as const,
    toolCalls: [
      {
        id: 'call-1',
        name: 'save_memory',
        arguments: { history_entry, memory_update },
      },
    ],
    usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
    thinkingBlocks: null,
  };
}

// ------------------------------------------------------------------ //
//  Mock builder                                                        //
// ------------------------------------------------------------------ //

function buildMocks() {
  const mockSessionMessage = {
    findMany: vi.fn(),
    count: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  };

  const mockSession = {
    update: vi.fn(),
  };

  const mockPrisma = {
    sessionMessage: mockSessionMessage,
    session: mockSession,
  };

  const mockSessionRepo = {
    update: vi.fn(),
  };

  const mockTokenCounter = {
    recordAggregateUsage: vi.fn().mockResolvedValue(undefined),
  };

  const mockProvider = {
    name: 'openai',
    chat: vi.fn(),
  };

  const mockContainerRunner: {
    start: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  } = {
    start: vi.fn(),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    stop: vi.fn(),
  };

  const mockProviderConfig = {
    resolveProvider: vi.fn().mockResolvedValue({ apiKey: 'test-api-key', apiBaseUrl: null }),
  };

  return {
    mockSessionMessage,
    mockSession,
    mockPrisma,
    mockSessionRepo,
    mockTokenCounter,
    mockProvider,
    mockContainerRunner,
    mockProviderConfig,
  };
}

// ------------------------------------------------------------------ //
//  Tests                                                              //
// ------------------------------------------------------------------ //

describe('MemoryConsolidationService', () => {
  let service: MemoryConsolidationService;
  let mocks: ReturnType<typeof buildMocks>;

  const defaultOptions = {
    agentRunId: 'run-1',
    userId: 'user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENAI_API_KEY'] = 'test-key';
    mocks = buildMocks();

    vi.mocked(createProvider).mockReturnValue(mocks.mockProvider);

    service = new MemoryConsolidationService(
      mocks.mockPrisma as unknown as PrismaService,
      mocks.mockTokenCounter as unknown as TokenCounterService,
      mocks.mockProviderConfig as unknown as import('../../provider-config/provider-config.service.js').ProviderConfigService,
    );
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
    delete process.env['CONTEXT_WINDOW_TOKENS'];
  });

  // ---------------------------------------------------------------- //
  //  estimateSessionTokens                                            //
  // ---------------------------------------------------------------- //

  describe('estimateSessionTokens', () => {
    it('returns char count / 4 summed across messages', async () => {
      // "Hello" = 5 chars → ceil(5/4) = 2 tokens
      // "World is great today" = 20 chars → ceil(20/4) = 5 tokens
      // Total = 7 tokens
      mocks.mockSessionMessage.findMany.mockResolvedValue([
        makeSessionMessage({ content: 'Hello', toolCalls: null }),
        makeSessionMessage({ id: 'msg-2', content: 'World is great today', toolCalls: null }),
      ]);

      const result = await service.estimateSessionTokens('session-1');

      expect(mocks.mockSessionMessage.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1', archivedAt: null },
        orderBy: { ordering: 'asc' },
      });
      expect(result).toBe(7);
    });

    it('includes toolCalls JSON in estimation', async () => {
      const toolCalls = [{ id: 'call-1', name: 'search', arguments: { q: 'test' } }];
      const toolCallsJson = JSON.stringify(toolCalls);
      const contentChars = 'Using tool'.length;
      const toolCallsChars = toolCallsJson.length;
      const expected = Math.ceil(contentChars / 4) + Math.ceil(toolCallsChars / 4);

      mocks.mockSessionMessage.findMany.mockResolvedValue([
        makeSessionMessage({ content: 'Using tool', toolCalls }),
      ]);

      const result = await service.estimateSessionTokens('session-1');

      expect(result).toBe(expected);
    });

    it('returns 0 for empty session', async () => {
      mocks.mockSessionMessage.findMany.mockResolvedValue([]);

      const result = await service.estimateSessionTokens('session-1');

      expect(result).toBe(0);
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — no-op when under threshold                //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — no-op when under threshold', () => {
    it('does nothing when estimated tokens are under the threshold', async () => {
      // Short messages → well under 65536 token default threshold
      mocks.mockSessionMessage.findMany.mockResolvedValue([
        makeSessionMessage({ content: 'Hello', toolCalls: null }),
      ]);

      await service.consolidateIfNeeded('session-1', defaultOptions);

      expect(mocks.mockProvider.chat).not.toHaveBeenCalled();
      expect(mocks.mockSessionMessage.updateMany).not.toHaveBeenCalled();
      expect(mocks.mockSessionMessage.deleteMany).not.toHaveBeenCalled();
    });

    it('returns consolidated:false when under threshold', async () => {
      mocks.mockSessionMessage.findMany.mockResolvedValue([
        makeSessionMessage({ content: 'Hello', toolCalls: null }),
      ]);

      const result = await service.consolidateIfNeeded('session-1', defaultOptions);

      expect(result).toEqual({ consolidated: false });
    });

    it('respects contextWindowTokens override', async () => {
      // 5 chars → ceil(5/4) = 2 tokens. Set threshold to 1 to force consolidation.
      // But we want to test the NO-op case: set threshold to 1000, which is > 2.
      mocks.mockSessionMessage.findMany.mockResolvedValue([
        makeSessionMessage({ content: 'Hello', toolCalls: null }),
      ]);

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 1000,
      });

      expect(mocks.mockProvider.chat).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — calls LLM and persists summary            //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — LLM consolidation', () => {
    /** Generate enough content to exceed a small context window. */
    function bigMessages(count = 20, contentSize = 100) {
      return Array.from({ length: count }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(contentSize),
          ordering: i + 1,
          toolCalls: null,
        }),
      );
    }

    it('calls LLM and persists summary when tokens exceed threshold', async () => {
      // 20 messages × 100 chars = 2000 chars → ~500 tokens. Threshold = 100.
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs) // estimateSessionTokens (initial)
        .mockResolvedValueOnce(msgs) // consolidation loop: find messages
        .mockResolvedValueOnce([]); // re-estimate after deletion → 0 tokens → stop

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledOnce();
      expect(mocks.mockSessionMessage.updateMany).toHaveBeenCalled();
      expect(mocks.mockSessionMessage.deleteMany).not.toHaveBeenCalled();
    });

    it('archives consolidated messages and upserts summary with [MEMORY SUMMARY] prefix and ordering 0', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]); // after consolidation, empty → 0 tokens → stop

      mocks.mockProvider.chat.mockResolvedValue(
        makeSaveMemoryResponse('history text', 'updated memory context'),
      );
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      // Should create a summary message with ordering 0 and [MEMORY SUMMARY] prefix
      expect(mocks.mockSessionMessage.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('[MEMORY SUMMARY]'),
              ordering: 0,
            }),
          ]),
        }),
      );

      // Should first archive old summary (if exists) and consolidated messages via soft-delete
      expect(mocks.mockSessionMessage.updateMany).toHaveBeenCalled();
      expect(mocks.mockSessionMessage.deleteMany).not.toHaveBeenCalled();
    });

    it('updates Session.lastConsolidatedAt after successful consolidation', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { lastConsolidatedAt: expect.any(Date) },
      });
    });

    it('returns ConsolidationResult with token metrics on success', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs) // estimateSessionTokens (initial)
        .mockResolvedValueOnce(msgs) // consolidation loop: find messages
        .mockResolvedValueOnce([]); // re-estimate after deletion → 0 tokens → stop

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      const result = await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(result.consolidated).toBe(true);
      expect(result.preTokens).toBeGreaterThan(0);
      expect(result.postTokens).toBeDefined();
      expect(result.roundsUsed).toBeGreaterThanOrEqual(1);
      expect(result.archivedCount).toBeGreaterThan(0);
    });

    it('records token usage after successful LLM consolidation', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockTokenCounter.recordAggregateUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
          agentRunId: 'run-1',
          userId: 'user-1',
        }),
      );
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — chunk selection (minimum turn boundary)   //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — chunk selection', () => {
    it('includes at least one full conversation turn even when first user message exceeds overBy', async () => {
      // Scenario: 6 messages alternating user/assistant.
      // First user message is very large (4000 chars ≈ 1000 tokens).
      // Remaining 5 messages: 40 chars each ≈ 10 tokens each ≈ 50 tokens total.
      // Total estimated ≈ 1050 tokens. threshold=800, target=400, overBy=650.
      // First user message alone (1000 tokens) >= overBy (650), but break requires
      // role=assistant. So loop continues to assistant (msg-1) and breaks there.
      // Chunk = [msg-0, msg-1] — one complete turn.
      const msgs = [
        makeSessionMessage({ id: 'msg-0', role: 'user', content: 'x'.repeat(4000), ordering: 1 }),
        makeSessionMessage({ id: 'msg-1', role: 'assistant', content: 'y'.repeat(40), ordering: 2 }),
        makeSessionMessage({ id: 'msg-2', role: 'user', content: 'z'.repeat(40), ordering: 3 }),
        makeSessionMessage({ id: 'msg-3', role: 'assistant', content: 'w'.repeat(40), ordering: 4 }),
        makeSessionMessage({ id: 'msg-4', role: 'user', content: 'a'.repeat(40), ordering: 5 }),
        makeSessionMessage({ id: 'msg-5', role: 'assistant', content: 'b'.repeat(40), ordering: 6 }),
      ];

      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs) // estimateSessionTokens (initial)
        .mockResolvedValueOnce(msgs) // consolidation loop: find messages
        .mockResolvedValueOnce([]);  // re-estimate after archival → 0 → stop

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: 2 });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 800,
        force: true,
      });

      // The updateMany call archives the chunk IDs + optional summary.
      // It must include at least msg-0 AND msg-1 (a full user+assistant turn).
      const archiveCall = mocks.mockSessionMessage.updateMany.mock.calls[0];
      expect(archiveCall).toBeDefined();
      const archivedIds: string[] = archiveCall![0].where.id.in;

      expect(archivedIds).toContain('msg-0');
      expect(archivedIds).toContain('msg-1');
      expect(archivedIds.length).toBeGreaterThanOrEqual(2);
    });

    it('compacts a meaningful portion when forced and session is under threshold', async () => {
      // Scenario: 8 small messages, total ≈ 200 tokens. Threshold=65536, target=32768.
      // Without fix: overBy = 200 - 32768 = -32568 (negative!), so chunkTokens >= overBy
      // is immediately true and only one turn gets compacted.
      // With fix: overBy = max(-32568, floor(200/2)) = 100, so roughly half the messages
      // are included in the chunk.
      const msgs = Array.from({ length: 8 }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `message ${i} content here`,
          ordering: i + 1,
        }),
      );

      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs) // estimateSessionTokens (initial)
        .mockResolvedValueOnce(msgs) // consolidation loop: find messages
        .mockResolvedValueOnce([]);  // re-estimate after archival → 0 → stop

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: 4 });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        force: true,
      });

      const archiveCall = mocks.mockSessionMessage.updateMany.mock.calls[0];
      expect(archiveCall).toBeDefined();
      const archivedIds: string[] = archiveCall![0].where.id.in;

      // Should compact more than just one turn (2 messages)
      expect(archivedIds.length).toBeGreaterThan(2);
    });

    it('does not split a user-assistant pair at chunk boundary (trailing assistant archived)', async () => {
      // Scenario: 6 messages ending with assistant. Each message ~100 chars ≈ 25 tokens.
      // Total ≈ 150 tokens. threshold=120, target=60, overBy=90.
      // With force: overBy = max(90, floor(150/2)=75) = 90.
      //
      // Chunk accumulation (25 tokens each):
      //   user(1): 25 < 90
      //   assistant(2): 50 < 90
      //   user(3): 75 < 90
      //   assistant(4): 100 >= 90 → should break HERE (assistant boundary, complete pair)
      //
      // BUG (before fix): break condition is row.role === 'user', so:
      //   assistant(4): 100 >= 90 but role=assistant → no break
      //   user(5): 125 >= 90 AND role=user → BREAK
      //   chunk = [user(1)..user(5)], assistant(6) orphaned with archivedAt=null
      //
      // EXPECTED: chunk breaks at assistant(4), archiving [user(1)..assistant(4)].
      //   Remaining = [user(5), assistant(6)] — a complete pair.
      const msgs = [
        makeSessionMessage({ id: 'msg-0', role: 'user', content: 'x'.repeat(100), ordering: 1 }),
        makeSessionMessage({ id: 'msg-1', role: 'assistant', content: 'y'.repeat(100), ordering: 2 }),
        makeSessionMessage({ id: 'msg-2', role: 'user', content: 'z'.repeat(100), ordering: 3 }),
        makeSessionMessage({ id: 'msg-3', role: 'assistant', content: 'w'.repeat(100), ordering: 4 }),
        makeSessionMessage({ id: 'msg-4', role: 'user', content: 'a'.repeat(100), ordering: 5 }),
        makeSessionMessage({ id: 'msg-5', role: 'assistant', content: 'b'.repeat(100), ordering: 6 }),
      ];

      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)  // estimateSessionTokens (initial)
        .mockResolvedValueOnce(msgs)  // consolidation loop: find messages
        .mockResolvedValueOnce([]);   // re-estimate after archival → 0 → stop

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: 4 });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 120,
        force: true,
      });

      const archiveCall = mocks.mockSessionMessage.updateMany.mock.calls[0];
      expect(archiveCall).toBeDefined();
      const archivedIds: string[] = archiveCall![0].where.id.in;

      // Must NOT include user(5) without its assistant(6) — that splits a pair.
      // Chunk should end at an assistant boundary: [msg-0, msg-1, msg-2, msg-3].
      expect(archivedIds).toContain('msg-0');
      expect(archivedIds).toContain('msg-1');
      expect(archivedIds).toContain('msg-2');
      expect(archivedIds).toContain('msg-3');
      expect(archivedIds).not.toContain('msg-4'); // user(5) stays with its pair
      expect(archivedIds).not.toContain('msg-5'); // assistant(6) stays with its pair
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — failure counter and fallback              //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — LLM failure handling', () => {
    function bigMessages(count = 20, contentSize = 100) {
      return Array.from({ length: count }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(contentSize),
          ordering: i + 1,
          toolCalls: null,
        }),
      );
    }

    it('falls back to raw archive after 3 consecutive LLM failures', async () => {
      const msgs = bigMessages(20, 100);

      // Always over threshold
      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);

      // Return a response with missing required fields to trigger validation failure
      const badResponse = {
        content: null,
        finishReason: 'tool_use' as const,
        toolCalls: [
          {
            id: 'call-bad',
            name: 'save_memory',
            arguments: { history_entry: '' }, // missing memory_update, empty history_entry
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        thinkingBlocks: null,
      };

      mocks.mockProvider.chat.mockResolvedValue(badResponse);
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      // After 3 failures, raw archive fallback should soft-delete (archive) messages
      expect(mocks.mockSessionMessage.updateMany).toHaveBeenCalled();
      expect(mocks.mockSessionMessage.deleteMany).not.toHaveBeenCalled();
    });

    it('resets failure counter on LLM success', async () => {
      const msgs = bigMessages(20, 100);

      // First call: messages over threshold; subsequent calls: empty (under threshold)
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs) // initial estimate
        .mockResolvedValueOnce(msgs) // loop pass 1: find messages
        .mockResolvedValueOnce([]); // re-estimate after consolidation (done)

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      // Should not throw
      await expect(
        service.consolidateIfNeeded('session-1', {
          ...defaultOptions,
          contextWindowTokens: 100,
        }),
      ).resolves.toEqual(expect.objectContaining({ consolidated: true }));

      expect(mocks.mockProvider.chat).toHaveBeenCalledOnce();
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — tool call validation                      //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — validates save_memory tool call', () => {
    function bigMessages(count = 20, contentSize = 100) {
      return Array.from({ length: count }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(contentSize),
          ordering: i + 1,
          toolCalls: null,
        }),
      );
    }

    it('rejects a save_memory tool call with missing history_entry', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);

      const badResponse = {
        content: null,
        finishReason: 'tool_use' as const,
        toolCalls: [
          {
            id: 'call-bad',
            name: 'save_memory',
            arguments: { memory_update: 'Some update' }, // missing history_entry
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        thinkingBlocks: null,
      };

      mocks.mockProvider.chat.mockResolvedValue(badResponse);
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      // Should not throw — falls back to raw archive after 3 failures
      await expect(
        service.consolidateIfNeeded('session-1', {
          ...defaultOptions,
          contextWindowTokens: 100,
        }),
      ).resolves.toEqual(expect.objectContaining({ consolidated: true }));

      // Should have called chat 3 times (exhausting failure limit before fallback)
      expect(mocks.mockProvider.chat).toHaveBeenCalledTimes(3);
    });

    it('rejects a save_memory tool call with missing memory_update', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);

      const badResponse = {
        content: null,
        finishReason: 'tool_use' as const,
        toolCalls: [
          {
            id: 'call-bad',
            name: 'save_memory',
            arguments: { history_entry: 'Some history' }, // missing memory_update
          },
        ],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        thinkingBlocks: null,
      };

      mocks.mockProvider.chat.mockResolvedValue(badResponse);
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await expect(
        service.consolidateIfNeeded('session-1', {
          ...defaultOptions,
          contextWindowTokens: 100,
        }),
      ).resolves.toEqual(expect.objectContaining({ consolidated: true }));

      expect(mocks.mockProvider.chat).toHaveBeenCalledTimes(3);
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — MEMORY.md writes                          //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — MEMORY.md writes', () => {
    function bigMessages(count = 20, contentSize = 100) {
      return Array.from({ length: count }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(contentSize),
          ordering: i + 1,
          toolCalls: null,
        }),
      );
    }

    it('writes memory_update to MEMORY.md when container is available', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      mocks.mockProvider.chat.mockResolvedValue(
        makeSaveMemoryResponse('history text', 'memory update'),
      );
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
        containerId: 'container-1',
        containerRunner: mocks.mockContainerRunner as unknown as IContainerRunner,
      });

      expect(mocks.mockContainerRunner.exec).toHaveBeenCalledWith(
        'container-1',
        ['sh', '-c', 'mkdir -p /workspace/memory && cat >> /workspace/memory/MEMORY.md'],
        expect.objectContaining({
          stdin: expect.stringContaining('memory update'),
        }),
      );
    });

    it('does not write to HISTORY.md', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      mocks.mockProvider.chat.mockResolvedValue(
        makeSaveMemoryResponse('history text', 'memory update'),
      );
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
        containerId: 'container-1',
        containerRunner: mocks.mockContainerRunner as unknown as IContainerRunner,
      });

      const calls = mocks.mockContainerRunner.exec.mock.calls;
      for (const call of calls) {
        expect(call[1]).not.toEqual(
          expect.arrayContaining([expect.stringContaining('HISTORY.md')]),
        );
      }
    });

    it('skips MEMORY.md when no container is available', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
        // No containerId or containerRunner
      });

      expect(mocks.mockContainerRunner.exec).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — toolChoice fallback                       //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — toolChoice fallback', () => {
    function bigMessages(count = 20, contentSize = 100) {
      return Array.from({ length: count }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(contentSize),
          ordering: i + 1,
          toolCalls: null,
        }),
      );
    }

    it('retries with auto when forced toolChoice is rejected via thrown error', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      mocks.mockProvider.chat
        .mockRejectedValueOnce(
          new Error('The tool_choice parameter does not support being set to required'),
        )
        .mockResolvedValueOnce(makeSaveMemoryResponse());

      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledTimes(2);
      const secondCallOptions = mocks.mockProvider.chat.mock.calls[1]![1];
      expect(secondCallOptions.toolChoice).toBe('auto');
    });

    it('retries with auto when finishReason is error with tool_choice content', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      const errorResponse = {
        content: 'Error: tool_choice does not support this setting',
        finishReason: 'error' as const,
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        thinkingBlocks: null,
      };

      mocks.mockProvider.chat
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(makeSaveMemoryResponse());

      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledTimes(2);
      const secondCallOptions = mocks.mockProvider.chat.mock.calls[1]![1];
      expect(secondCallOptions.toolChoice).toBe('auto');
    });

    it('does not retry for non-tool-choice errors', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);

      mocks.mockProvider.chat.mockRejectedValue(new Error('Rate limit exceeded'));
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledTimes(3);
      for (const call of mocks.mockProvider.chat.mock.calls) {
        expect(call[1].toolChoice).toEqual({ name: 'save_memory' });
      }
    });

    it('does not retry for finishReason error with non-matching content', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);

      const errorResponse = {
        content: 'Internal server error',
        finishReason: 'error' as const,
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        thinkingBlocks: null,
      };

      mocks.mockProvider.chat.mockResolvedValue(errorResponse);
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledTimes(3);
      for (const call of mocks.mockProvider.chat.mock.calls) {
        expect(call[1].toolChoice).toEqual({ name: 'save_memory' });
      }
    });

    it('counts as one failure when auto fallback also produces no tool call', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);

      const noToolResponse = {
        content: 'Here is a summary.',
        finishReason: 'stop' as const,
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        thinkingBlocks: null,
      };

      mocks.mockProvider.chat
        .mockRejectedValueOnce(new Error('tool_choice does not support required'))
        .mockResolvedValueOnce(noToolResponse)
        .mockRejectedValueOnce(new Error('tool_choice does not support required'))
        .mockResolvedValueOnce(noToolResponse)
        .mockRejectedValueOnce(new Error('tool_choice does not support required'))
        .mockResolvedValueOnce(noToolResponse);

      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledTimes(6);
      expect(mocks.mockSessionMessage.updateMany).toHaveBeenCalled();
      expect(mocks.mockSessionMessage.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — session locking                           //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — session locking', () => {
    function bigMessages(count = 20, contentSize = 100) {
      return Array.from({ length: count }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(contentSize),
          ordering: i + 1,
          toolCalls: null,
        }),
      );
    }

    it('serializes concurrent calls on the same session', async () => {
      const msgs = bigMessages(20, 100);
      const callOrder: string[] = [];

      let resolveFirst!: () => void;
      const firstCallStarted = new Promise<void>((r) => {
        resolveFirst = r;
      });
      let resolveFirstChat!: (v: unknown) => void;
      const firstChatPromise = new Promise((r) => {
        resolveFirstChat = r;
      });

      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      let chatCallCount = 0;
      mocks.mockProvider.chat.mockImplementation(() => {
        chatCallCount++;
        if (chatCallCount === 1) {
          callOrder.push('first-start');
          resolveFirst();
          return firstChatPromise;
        }
        callOrder.push('second-start');
        mocks.mockSessionMessage.findMany.mockResolvedValueOnce([]);
        return Promise.resolve(makeSaveMemoryResponse());
      });

      const first = service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      await firstCallStarted;

      const second = service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(callOrder).toEqual(['first-start']);

      mocks.mockSessionMessage.findMany.mockResolvedValueOnce([]);
      resolveFirstChat(makeSaveMemoryResponse());

      await first;
      await second;

      expect(callOrder).toContain('first-start');
      expect(callOrder).toContain('second-start');
      expect(callOrder.indexOf('first-start')).toBeLessThan(callOrder.indexOf('second-start'));
    });

    it('does not block different sessions', async () => {
      const msgs = bigMessages(20, 100);
      const callOrder: string[] = [];

      let resolveFirstChat!: (v: unknown) => void;
      const firstChatPromise = new Promise((r) => {
        resolveFirstChat = r;
      });

      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      let chatCallCount = 0;
      mocks.mockProvider.chat.mockImplementation(() => {
        chatCallCount++;
        if (chatCallCount === 1) {
          callOrder.push('session-1-start');
          return firstChatPromise;
        }
        callOrder.push('session-2-start');
        mocks.mockSessionMessage.findMany.mockResolvedValueOnce([]);
        return Promise.resolve(makeSaveMemoryResponse());
      });

      const first = service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      await new Promise((r) => setTimeout(r, 10));

      const second = service.consolidateIfNeeded('session-2', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(callOrder).toContain('session-1-start');
      expect(callOrder).toContain('session-2-start');

      mocks.mockSessionMessage.findMany.mockResolvedValue([]);
      resolveFirstChat(makeSaveMemoryResponse());
      await first;
      await second;
    });

    it('error in first call does not block the second', async () => {
      const msgs = bigMessages(20, 100);

      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValue([]);

      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      mocks.mockProvider.chat
        .mockRejectedValueOnce(new Error('fail-1'))
        .mockRejectedValueOnce(new Error('fail-2'))
        .mockRejectedValueOnce(new Error('fail-3'))
        .mockResolvedValueOnce(makeSaveMemoryResponse());

      const first = service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      const second = service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      await expect(first).resolves.toEqual(expect.objectContaining({ consolidated: true }));
      // Second call runs after first; session is now empty (0 tokens) so under threshold → no-op
      await expect(second).resolves.toMatchObject({ consolidated: expect.any(Boolean) });
    });
  });
  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — force flag                               //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — force flag', () => {
    /** 5 messages × 20 chars = 100 chars → ~25 tokens, well under default 65536 threshold. */
    function smallMessages() {
      return Array.from({ length: 5 }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(20),
          ordering: i + 1,
          toolCalls: null,
        }),
      );
    }

    it('consolidates when force is true even if under threshold', async () => {
      const msgs = smallMessages();
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs) // estimateSessionTokens
        .mockResolvedValueOnce(msgs) // consolidation loop: find messages
        .mockResolvedValueOnce([]); // re-estimate after deletion → stop

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        force: true,
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledOnce();
      expect(mocks.mockSessionMessage.updateMany).toHaveBeenCalled();
      expect(mocks.mockSessionMessage.deleteMany).not.toHaveBeenCalled();
    });

    it('skips consolidation when force is false and under threshold', async () => {
      const msgs = smallMessages();
      mocks.mockSessionMessage.findMany.mockResolvedValue(msgs);

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        force: false,
      });

      expect(mocks.mockProvider.chat).not.toHaveBeenCalled();
      expect(mocks.mockSessionMessage.updateMany).not.toHaveBeenCalled();
      expect(mocks.mockSessionMessage.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- //
  //  consolidateIfNeeded — customInstructions prompt injection        //
  // ---------------------------------------------------------------- //

  describe('consolidateIfNeeded — customInstructions', () => {
    function bigMessages(count = 20, contentSize = 100) {
      return Array.from({ length: count }, (_, i) =>
        makeSessionMessage({
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(contentSize),
          ordering: i + 1,
          toolCalls: null,
        }),
      );
    }

    it('appends custom instructions to the LLM user prompt when provided', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
        customInstructions: 'focus on database migration decisions',
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledOnce();
      const chatArgs = mocks.mockProvider.chat.mock.calls[0]!;
      const messages = chatArgs[0] as Array<{ role: string; content: string }>;
      const userMessage = messages.find((m) => m.role === 'user');
      expect(userMessage?.content).toContain('Additional instructions: focus on database migration decisions');
    });

    it('does not include custom instructions block when not provided', async () => {
      const msgs = bigMessages(20, 100);
      mocks.mockSessionMessage.findMany
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce(msgs)
        .mockResolvedValueOnce([]);

      mocks.mockProvider.chat.mockResolvedValue(makeSaveMemoryResponse());
      mocks.mockSessionMessage.updateMany.mockResolvedValue({ count: msgs.length });
      mocks.mockSessionMessage.createMany.mockResolvedValue({ count: 1 });
      mocks.mockSession.update.mockResolvedValue({});

      await service.consolidateIfNeeded('session-1', {
        ...defaultOptions,
        contextWindowTokens: 100,
      });

      expect(mocks.mockProvider.chat).toHaveBeenCalledOnce();
      const chatArgs = mocks.mockProvider.chat.mock.calls[0]!;
      const messages = chatArgs[0] as Array<{ role: string; content: string }>;
      const userMessage = messages.find((m) => m.role === 'user');
      expect(userMessage?.content).not.toContain('Additional instructions');
    });
  });
});

describe('normalizeSaveMemoryArgs', () => {
  it('passes through a plain object unchanged', () => {
    const args = { history_entry: 'test', memory_update: 'update' };
    expect(normalizeSaveMemoryArgs(args)).toEqual(args);
  });

  it('parses a JSON string containing an object', () => {
    const obj = { history_entry: 'test', memory_update: 'update' };
    expect(normalizeSaveMemoryArgs(JSON.stringify(obj))).toEqual(obj);
  });

  it('returns null for a JSON string containing a non-object', () => {
    expect(normalizeSaveMemoryArgs('"just a string"')).toBeNull();
  });

  it('returns null for a double-wrapped JSON string', () => {
    const obj = { history_entry: 'test' };
    const doubleWrapped = JSON.stringify(JSON.stringify(obj));
    expect(normalizeSaveMemoryArgs(doubleWrapped)).toBeNull();
  });

  it('extracts first element from an array with a dict', () => {
    const obj = { history_entry: 'test', memory_update: 'update' };
    expect(normalizeSaveMemoryArgs([obj])).toEqual(obj);
  });

  it('returns null for an empty array', () => {
    expect(normalizeSaveMemoryArgs([])).toBeNull();
  });

  it('returns null for an array with a non-dict first element', () => {
    expect(normalizeSaveMemoryArgs(['string', 'content'])).toBeNull();
  });

  it('returns null for an array with a nested array first element', () => {
    expect(normalizeSaveMemoryArgs([[{ a: 1 }]])).toBeNull();
  });

  it('returns null for null', () => {
    expect(normalizeSaveMemoryArgs(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeSaveMemoryArgs(undefined)).toBeNull();
  });

  it('returns null for a number', () => {
    expect(normalizeSaveMemoryArgs(42)).toBeNull();
  });

  it('returns null for invalid JSON string', () => {
    expect(normalizeSaveMemoryArgs('{not json')).toBeNull();
  });
});

describe('isToolChoiceUnsupported', () => {
  it('returns true for error containing tool_choice + does not support', () => {
    expect(
      isToolChoiceUnsupported('The tool_choice parameter does not support being set to required'),
    ).toBe(true);
  });

  it('returns true for error containing toolchoice + not supported', () => {
    expect(isToolChoiceUnsupported('toolchoice is not supported for this model')).toBe(true);
  });

  it('returns true for error containing tool_choice + should be ["none", "auto"]', () => {
    expect(isToolChoiceUnsupported('tool_choice should be ["none", "auto"]')).toBe(true);
  });

  it('returns false for "does not support" without tool_choice keyword', () => {
    expect(isToolChoiceUnsupported('This model does not support streaming')).toBe(false);
  });

  it('returns false for tool_choice without rejection phrase', () => {
    expect(isToolChoiceUnsupported('tool_choice set to auto')).toBe(false);
  });

  it('returns false for unrelated error', () => {
    expect(isToolChoiceUnsupported('Rate limit exceeded')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isToolChoiceUnsupported(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isToolChoiceUnsupported(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isToolChoiceUnsupported('')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isToolChoiceUnsupported('TOOL_CHOICE Does Not Support this')).toBe(true);
  });
});

// ------------------------------------------------------------------ //
//  getTokenWarningState                                               //
// ------------------------------------------------------------------ //

describe('getTokenWarningState', () => {
  let service: MemoryConsolidationService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = buildMocks();
    vi.mocked(createProvider).mockReturnValue(mocks.mockProvider);

    service = new MemoryConsolidationService(
      mocks.mockPrisma as unknown as PrismaService,
      mocks.mockTokenCounter as unknown as TokenCounterService,
      mocks.mockProviderConfig as unknown as import('../../provider-config/provider-config.service.js').ProviderConfigService,
    );
  });

  afterEach(() => {
    delete process.env['CONTEXT_WINDOW_TOKENS'];
  });

  it("returns warning 'none' when ratio is under 0.75", async () => {
    // Short content — well under 75% of 65536 default threshold
    mocks.mockSessionMessage.findMany.mockResolvedValue([
      makeSessionMessage({ content: 'Hi', toolCalls: null }),
    ]);

    const state = await service.getTokenWarningState('session-1');

    expect(state.warning).toBe('none');
    expect(state.threshold).toBe(65536);
    expect(state.estimated).toBeGreaterThan(0);
    expect(state.ratio).toBeLessThan(0.75);
  });

  it("returns warning 'approaching' when ratio is between 0.75 and 0.90", async () => {
    // ~80% of threshold=100 → need ~80 tokens → ~320 chars
    const content = 'a'.repeat(320);
    mocks.mockSessionMessage.findMany.mockResolvedValue([
      makeSessionMessage({ content, toolCalls: null }),
    ]);

    const state = await service.getTokenWarningState('session-1', 100);

    expect(state.warning).toBe('approaching');
    expect(state.threshold).toBe(100);
    expect(state.ratio).toBeGreaterThanOrEqual(0.75);
    expect(state.ratio).toBeLessThan(0.90);
  });

  it("returns warning 'critical' when ratio is 0.90 or above", async () => {
    // ~95% of threshold=100 → need ~95 tokens → ~380 chars
    const content = 'a'.repeat(380);
    mocks.mockSessionMessage.findMany.mockResolvedValue([
      makeSessionMessage({ content, toolCalls: null }),
    ]);

    const state = await service.getTokenWarningState('session-1', 100);

    expect(state.warning).toBe('critical');
    expect(state.threshold).toBe(100);
    expect(state.ratio).toBeGreaterThanOrEqual(0.90);
  });

  it("returns warning 'none' for empty session", async () => {
    mocks.mockSessionMessage.findMany.mockResolvedValue([]);

    const state = await service.getTokenWarningState('session-1');

    expect(state.warning).toBe('none');
    expect(state.estimated).toBe(0);
    expect(state.ratio).toBe(0);
  });

  it('respects custom threshold parameter', async () => {
    mocks.mockSessionMessage.findMany.mockResolvedValue([
      makeSessionMessage({ content: 'Hello', toolCalls: null }),
    ]);

    const state = await service.getTokenWarningState('session-1', 100);

    expect(state.threshold).toBe(100);
  });
});
