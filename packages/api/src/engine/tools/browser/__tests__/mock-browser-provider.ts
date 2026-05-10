import type { BrowserProvider, BrowserSession } from '../browser-provider.js';

export interface MockCall {
  op: 'acquire' | 'release';
  runId: string;
}

export class MockBrowserProvider implements BrowserProvider {
  readonly name = 'mock';
  private readonly sessions = new Map<string, BrowserSession>();
  readonly calls: MockCall[] = [];
  private counter = 0;

  async acquireSession(runId: string): Promise<BrowserSession> {
    this.calls.push({ op: 'acquire', runId });
    const existing = this.sessions.get(runId);
    if (existing) return existing;
    const session: BrowserSession = {
      cdpUrl: `mock://session/${runId}`,
      contextId: `mock-ctx-${++this.counter}`,
      providerName: this.name,
    };
    this.sessions.set(runId, session);
    return session;
  }

  async releaseSession(runId: string): Promise<void> {
    this.calls.push({ op: 'release', runId });
    this.sessions.delete(runId);
  }
}
