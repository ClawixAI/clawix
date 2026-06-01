import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from '../api';

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': '2' }),
    json: async () => ({}),
  } as unknown as Response;
}

function headersOf(call: unknown): Record<string, string> {
  const init = (call as [string, RequestInit])[1];
  return init.headers as Record<string, string>;
}

describe('apiFetch — Content-Type handling', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does NOT set application/json for a FormData body (browser adds the boundary)', async () => {
    const body = new FormData();
    body.append('file', new Blob(['x']), 'f.txt');

    await apiFetch('/upload', { method: 'POST', body });

    expect(headersOf(fetchMock.mock.calls[0])['Content-Type']).toBeUndefined();
  });

  it('sets application/json for a non-FormData body', async () => {
    await apiFetch('/items', { method: 'POST', body: JSON.stringify({ a: 1 }) });

    expect(headersOf(fetchMock.mock.calls[0])['Content-Type']).toBe('application/json');
  });
});
