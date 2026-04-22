import { describe, expect, it, vi } from 'vitest';
import { SessionMessageStore } from '../../message-store/session-message-store.js';

describe('SessionMessageStore', () => {
  it('loadMessages delegates to sessionManager.loadMessages with the provided sessionId', async () => {
    const sessionManager = {
      loadMessages: vi.fn().mockResolvedValue([{ role: 'user', content: 'hi' }]),
      saveMessages: vi.fn(),
    };
    const store = new SessionMessageStore(sessionManager as never, 'sess-1');
    const msgs = await store.loadMessages();
    expect(sessionManager.loadMessages).toHaveBeenCalledWith('sess-1');
    expect(msgs).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('saveMessages delegates to sessionManager.saveMessages', async () => {
    const sessionManager = {
      loadMessages: vi.fn(),
      saveMessages: vi.fn().mockResolvedValue(['id-1']),
    };
    const store = new SessionMessageStore(sessionManager as never, 'sess-1');
    const ids = await store.saveMessages([{ role: 'assistant', content: 'ok' }]);
    expect(sessionManager.saveMessages).toHaveBeenCalledWith('sess-1', [
      { role: 'assistant', content: 'ok' },
    ]);
    expect(ids).toEqual(['id-1']);
  });
});
