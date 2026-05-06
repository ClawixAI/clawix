import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@clawix/shared';
import { CompressorService } from '../compressor.js';

interface MockDeps {
  resolveProvider: ReturnType<typeof vi.fn>;
  systemSettingsGet: ReturnType<typeof vi.fn>;
  chat: ReturnType<typeof vi.fn>;
}

function makeMockDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    resolveProvider: vi.fn().mockResolvedValue({ apiKey: 'k', apiBaseUrl: null }),
    systemSettingsGet: vi.fn().mockResolvedValue({}),
    chat: vi.fn().mockResolvedValue({ content: 'summary text', toolCalls: [], usage: {} }),
    ...overrides,
  };
}

function userMsg(text: string): ChatMessage {
  return { role: 'user', content: text } as ChatMessage;
}
function asstMsg(text: string): ChatMessage {
  return { role: 'assistant', content: text } as ChatMessage;
}

function buildService(deps: MockDeps): CompressorService {
  return new CompressorService(
    { resolveProvider: deps.resolveProvider } as never,
    { get: deps.systemSettingsGet } as never,
    { create: () => ({ chat: deps.chat, name: 'mock' }) } as never,
  );
}

describe('CompressorService', () => {
  describe('boundary detection', () => {
    it('preserves the last 2 user-message cycles verbatim', async () => {
      const deps = makeMockDeps();
      const svc = buildService(deps);
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys' } as ChatMessage,
        userMsg('u1'),
        asstMsg('a1'),
        userMsg('u2'),
        asstMsg('a2'),
        userMsg('u3'),
        asstMsg('a3'),
        userMsg('u4'), // 2nd-to-last user
        asstMsg('a4'),
        userMsg('u5'), // last user
        asstMsg('a5'),
      ];
      const result = await svc.compress(messages, { provider: 'anthropic', model: 'm' });
      // System + summary header + last 2 cycles = 6 messages
      expect(result.length).toBe(6);
      expect(result[0]!.role).toBe('system'); // original system prompt preserved
      expect(result[1]!.role).toBe('system'); // synthetic summary header
      expect((result[1]! as { content: string }).content).toContain('summary');
      expect((result[2]! as { content: string }).content).toBe('u4');
      expect((result[5]! as { content: string }).content).toBe('a5');
    });

    it('returns messages unchanged when there are fewer than 2 user cycles', async () => {
      const deps = makeMockDeps();
      const svc = buildService(deps);
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys' } as ChatMessage,
        userMsg('u1'),
        asstMsg('a1'),
      ];
      const result = await svc.compress(messages, { provider: 'anthropic', model: 'm' });
      expect(result).toEqual(messages);
      expect(deps.chat).not.toHaveBeenCalled();
    });
  });

  describe('compression model resolution', () => {
    it('uses systemSettings.compressionModel when set', async () => {
      const deps = makeMockDeps({
        systemSettingsGet: vi
          .fn()
          .mockResolvedValue({ compressionModel: { provider: 'openai', model: 'gpt-mini' } }),
        resolveProvider: vi.fn().mockResolvedValue({ apiKey: 'kk', apiBaseUrl: null }),
      });
      const svc = buildService(deps);
      const messages: ChatMessage[] = [
        { role: 'system', content: 's' } as ChatMessage,
        userMsg('u1'),
        asstMsg('a1'),
        userMsg('u2'),
        asstMsg('a2'),
        userMsg('u3'),
        asstMsg('a3'),
      ];
      await svc.compress(messages, { provider: 'anthropic', model: 'sonnet' });
      expect(deps.resolveProvider).toHaveBeenCalledWith('openai');
    });

    it('falls back to fallbackProviderModel when compressionModel is unset', async () => {
      const deps = makeMockDeps({ systemSettingsGet: vi.fn().mockResolvedValue({}) });
      const svc = buildService(deps);
      const messages: ChatMessage[] = [
        { role: 'system', content: 's' } as ChatMessage,
        userMsg('u1'),
        asstMsg('a1'),
        userMsg('u2'),
        asstMsg('a2'),
        userMsg('u3'),
        asstMsg('a3'),
      ];
      await svc.compress(messages, { provider: 'anthropic', model: 'sonnet' });
      expect(deps.resolveProvider).toHaveBeenCalledWith('anthropic');
    });

    it('falls back when compressionModel resolves but provider lookup fails', async () => {
      const deps = makeMockDeps({
        systemSettingsGet: vi
          .fn()
          .mockResolvedValue({ compressionModel: { provider: 'deleted-provider', model: 'm' } }),
      });
      let firstCall = true;
      deps.resolveProvider.mockImplementation(async (name: string) => {
        if (firstCall && name === 'deleted-provider') {
          firstCall = false;
          throw new Error('No provider config found');
        }
        return { apiKey: 'k', apiBaseUrl: null };
      });
      const svc = buildService(deps);
      const messages: ChatMessage[] = [
        { role: 'system', content: 's' } as ChatMessage,
        userMsg('u1'),
        asstMsg('a1'),
        userMsg('u2'),
        asstMsg('a2'),
        userMsg('u3'),
        asstMsg('a3'),
      ];
      await svc.compress(messages, { provider: 'anthropic', model: 'sonnet' });
      // First call to deleted-provider failed; fallback to anthropic was called.
      expect(deps.resolveProvider).toHaveBeenCalledWith('anthropic');
    });
  });

  describe('tool-use/tool-result pairing safety', () => {
    it('handles cross-cut tool_use/tool_result by expanding boundary backward', async () => {
      // Construct a case where the naive boundary cuts a tool_use from its tool_result:
      // index 0: system
      // 1: u1
      // 2: a1
      // 3: u2
      // 4: a2 with toolCalls=[tc-X]
      // 5: u3  <- naive 2nd-to-last user (boundary candidate)
      // 6: tool toolCallId=tc-X  <- cross-cut: tool_use on older side, result on kept side
      // 7: a3
      // 8: u4  <- last user
      // 9: a4
      //
      // Expected: boundary expands back to u2 (index 3), making tc-X's pair entirely
      // on the older side (both a2[tc-X] and tool(tc-X) go into the summarized block).
      const deps = makeMockDeps();
      const svc = buildService(deps);
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys' } as ChatMessage, // 0
        userMsg('u1'), // 1
        asstMsg('a1'), // 2
        userMsg('u2'), // 3
        {
          role: 'assistant',
          content: 'fetching',
          toolCalls: [{ id: 'tc-X', name: 'web_fetch', arguments: { url: 'http://x' } }],
        } as ChatMessage, // 4
        userMsg('u3'), // 5  <- naive boundary
        { role: 'tool', content: 'result', toolCallId: 'tc-X' } as ChatMessage, // 6 cross-cut
        asstMsg('a3'), // 7
        userMsg('u4'), // 8
        asstMsg('a4'), // 9
      ];
      const result = await svc.compress(messages, { provider: 'anthropic', model: 'm' });
      // Boundary expands to u2 (index 3). Output: [sys, summary, u2, a2[tc-X], u3, tool(tc-X), a3, u4, a4]
      // = 1 (system) + 1 (summary) + 7 (kept: indices 3-9) = 9
      expect(result.length).toBe(9);
      expect(result[0]!.role).toBe('system');
      expect(result[1]!.role).toBe('system');
      expect((result[1]! as { content: string }).content).toContain('summary');
      expect((result[2]! as { content: string }).content).toBe('u2');
      expect((result[8]! as { content: string }).content).toBe('a4');
    });

    it('does not expand boundary when tool_use/tool_result pair is entirely on kept side', async () => {
      const deps = makeMockDeps();
      const svc = buildService(deps);
      // u1, a1, u2, a2, u3, a3[tc-Y], tool(tc-Y), a3-final, u4, a4[tc-Z], tool(tc-Z), a4-final, u5, a5
      // Naive boundary = u4 (2nd-to-last user). a4[tc-Z] and tool(tc-Z) are both on kept side — safe.
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys' } as ChatMessage,
        userMsg('u1'),
        asstMsg('a1'),
        userMsg('u2'),
        asstMsg('a2'),
        userMsg('u3'),
        {
          role: 'assistant',
          content: 'older-tool',
          toolCalls: [{ id: 'tc-Y', name: 't', arguments: {} }],
        } as ChatMessage,
        { role: 'tool', content: 'res-Y', toolCallId: 'tc-Y' } as ChatMessage,
        asstMsg('a3-final'),
        userMsg('u4'), // boundary (2nd-to-last)
        {
          role: 'assistant',
          content: 'new-tool',
          toolCalls: [{ id: 'tc-Z', name: 't', arguments: {} }],
        } as ChatMessage,
        { role: 'tool', content: 'res-Z', toolCallId: 'tc-Z' } as ChatMessage,
        asstMsg('a4-final'),
        userMsg('u5'), // last user
        asstMsg('a5'),
      ];
      const result = await svc.compress(messages, { provider: 'anthropic', model: 'm' });
      // Boundary at u4 (index 9). Kept side: u4..a5 = 6 messages.
      // Output: system + summary + 6 kept = 8
      expect(result.length).toBe(8);
      expect((result[2]! as { content: string }).content).toBe('u4');
      expect((result[7]! as { content: string }).content).toBe('a5');
    });
  });

  describe('system message dedup', () => {
    it('does not duplicate system messages that live at or after the boundary', async () => {
      const deps = makeMockDeps();
      const svc = buildService(deps);
      const messages: ChatMessage[] = [
        { role: 'system', content: 'sys-1' } as ChatMessage,
        userMsg('u1'),
        asstMsg('a1'),
        userMsg('u2'),
        asstMsg('a2'),
        { role: 'system', content: 'sys-2' } as ChatMessage, // injected mid-conversation
        userMsg('u3'),
        asstMsg('a3'),
      ];
      const result = await svc.compress(messages, { provider: 'anthropic', model: 'm' });
      // System messages in output: sys-1, sys-2 (both from original), plus synthetic summary.
      const systemMessages = result.filter((m) => m.role === 'system');
      expect(systemMessages.length).toBe(3);
      const systemContents = systemMessages.map((m) => (m as { content: string }).content);
      // sys-2 should appear exactly once (not duplicated from afterBoundary)
      expect(systemContents.filter((c) => c === 'sys-2')).toHaveLength(1);
    });
  });

  describe('summarizer call', () => {
    it('passes microcompacted older messages to the summarizer', async () => {
      const deps = makeMockDeps();
      const svc = buildService(deps);
      const messages: ChatMessage[] = [
        { role: 'system', content: 's' } as ChatMessage,
        userMsg('u1'),
        asstMsg('a1'),
        userMsg('u2'),
        asstMsg('a2'),
        userMsg('u3'),
        asstMsg('a3'),
      ];
      await svc.compress(messages, { provider: 'anthropic', model: 'sonnet' });
      expect(deps.chat).toHaveBeenCalledTimes(1);
      const [chatMessages, chatOpts] = deps.chat.mock.calls[0]!;
      expect(Array.isArray(chatMessages)).toBe(true);
      // Summarizer receives a system+user prompt pair built from older messages
      expect(chatMessages.length).toBeGreaterThanOrEqual(2);
      expect((chatMessages[0] as { role: string }).role).toBe('system');
      void chatOpts;
    });
  });
});
