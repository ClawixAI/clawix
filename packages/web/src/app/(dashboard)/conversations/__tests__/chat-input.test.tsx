import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from '../chat-input';

// ChatInput fetches /api/v1/skills on mount; stub it so no real network runs.
vi.mock('@/lib/auth', () => ({
  authFetch: vi.fn().mockResolvedValue({ data: [] }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * History nav (#152) must gate on the absolute caret edge, not logical-line
 * detection. A long sentence that soft-wraps via CSS contains no '\n', so the
 * old `!value.slice(...).includes('\n')` check treated every wrapped row as the
 * first/last line and hijacked ArrowUp/Down for history (#157). These tests
 * exercise the gate purely through caret offset, which jsdom supports.
 */
describe('ChatInput history navigation — caret-edge gating (#157)', () => {
  const history = ['most recent message', 'older message'];

  function setup() {
    render(
      createElement(ChatInput, {
        onSend: () => true,
        disabled: false,
        isConnected: true,
        userMessages: history,
      }),
    );
    return screen.getByLabelText('Chat message') as HTMLTextAreaElement;
  }

  // A long single-line draft with no newline — exactly what CSS soft-wrap produces.
  const wrapped = 'a'.repeat(200);

  it('does NOT recall history on ArrowUp when caret is mid-draft (wrapped line, no newline)', () => {
    const ta = setup();
    fireEvent.change(ta, { target: { value: wrapped } });
    ta.selectionStart = ta.selectionEnd = 100; // caret in the middle of the wrapped line
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    expect(ta.value).toBe(wrapped); // caret moves natively; history untouched
  });

  it('recalls the most recent message on ArrowUp only when caret is at position 0', () => {
    const ta = setup();
    fireEvent.change(ta, { target: { value: wrapped } });
    ta.selectionStart = ta.selectionEnd = 0;
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    expect(ta.value).toBe(history[0]);
  });

  it('does NOT recall history on ArrowUp with a non-collapsed selection at the start', () => {
    const ta = setup();
    fireEvent.change(ta, { target: { value: wrapped } });
    ta.selectionStart = 0;
    ta.selectionEnd = 10; // selection, not a collapsed caret
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    expect(ta.value).toBe(wrapped);
  });

  // Helper: press ArrowUp with the caret pinned at the start (the setTimeout
  // caret-reset in the component is async and won't fire under fireEvent).
  function arrowUpFromStart(ta: HTMLTextAreaElement) {
    ta.selectionStart = ta.selectionEnd = 0;
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
  }

  it('does NOT recall newer history on ArrowDown when caret is mid-draft', () => {
    const ta = setup();
    // First climb into history so historyIndexRef >= 0.
    fireEvent.change(ta, { target: { value: '' } });
    arrowUpFromStart(ta);
    arrowUpFromStart(ta);
    expect(ta.value).toBe(history[1]); // now on the older entry

    // Caret mid-text → ArrowDown must move the caret, not walk history.
    ta.selectionStart = ta.selectionEnd = 2;
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    expect(ta.value).toBe(history[1]);
  });

  it('walks back down history on ArrowDown only when caret is at the end of the text', () => {
    const ta = setup();
    fireEvent.change(ta, { target: { value: '' } });
    arrowUpFromStart(ta);
    arrowUpFromStart(ta);
    expect(ta.value).toBe(history[1]);

    ta.selectionStart = ta.selectionEnd = ta.value.length;
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    expect(ta.value).toBe(history[0]);
  });
});
