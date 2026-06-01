import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@clawix/shared';
import { computeHiddenInHistory } from '../history-visibility.js';

const asst = (content: string, toolCalls?: ChatMessage['toolCalls']): ChatMessage => ({
  role: 'assistant',
  content,
  ...(toolCalls ? { toolCalls } : {}),
});
const tool = (content: string): ChatMessage => ({ role: 'tool', content, toolCallId: 't1' });

describe('computeHiddenInHistory', () => {
  it('hides nothing for a streamed run (every step was shown live)', () => {
    const messages: ChatMessage[] = [
      asst('Let me check.', [{ id: 't1', name: 'search', arguments: {} }]),
      tool('result'),
      asst('Here is the answer.'),
    ];
    expect(computeHiddenInHistory(messages, true)).toEqual([false, false, false]);
  });

  it('hides intermediate steps for a non-streamed run, keeping only the final assistant message', () => {
    const messages: ChatMessage[] = [
      asst('Let me check.', [{ id: 't1', name: 'search', arguments: {} }]),
      tool('result'),
      asst('Here is the answer.'),
    ];
    // Only the last assistant message (the final reply the user saw live) stays visible.
    expect(computeHiddenInHistory(messages, false)).toEqual([true, true, false]);
  });

  it('hides nothing for a single-message non-streamed run', () => {
    const messages: ChatMessage[] = [asst('Direct answer, no tools.')];
    expect(computeHiddenInHistory(messages, false)).toEqual([false]);
  });

  it('keeps the LAST assistant visible even if a trailing non-assistant message follows', () => {
    const messages: ChatMessage[] = [
      asst('Working...', [{ id: 't1', name: 'search', arguments: {} }]),
      asst('Final reply.'),
      tool('late tool row'),
    ];
    expect(computeHiddenInHistory(messages, false)).toEqual([true, false, true]);
  });

  it('defensively hides nothing when there is no assistant message', () => {
    const messages: ChatMessage[] = [tool('orphan result')];
    expect(computeHiddenInHistory(messages, false)).toEqual([false]);
  });

  it('returns an empty array for empty input', () => {
    expect(computeHiddenInHistory([], false)).toEqual([]);
    expect(computeHiddenInHistory([], true)).toEqual([]);
  });
});
