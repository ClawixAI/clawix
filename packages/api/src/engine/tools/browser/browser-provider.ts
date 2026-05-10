/**
 * BrowserProvider abstraction — produces and disposes of isolated browser
 * sessions (one BrowserContext per agent run).
 *
 * Implementations: LocalProvider (default, sidecar), BrowserbaseProvider
 * (cloud opt-in), CdpProvider (BYO endpoint).
 */

export interface BrowserSession {
  /** WebSocket URL for Playwright/CDP connect. */
  readonly cdpUrl: string;
  /** Identifies the BrowserContext within the provider. */
  readonly contextId: string;
  /** For logs / error attribution. */
  readonly providerName: string;
}

export interface BrowserProvider {
  readonly name: string;

  /**
   * Acquire (or return the existing) session for a run. Idempotent: a second
   * call with the same runId returns the same BrowserSession.
   */
  acquireSession(runId: string): Promise<BrowserSession>;

  /**
   * Release the session for a run. Idempotent: safe to call when no session
   * exists. Never throws — failures must be logged and swallowed.
   */
  releaseSession(runId: string): Promise<void>;
}

/** Thrown when a provider's required env config is missing or wrong. */
export class BrowserProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserProviderConfigError';
  }
}

/** Thrown when the provider cannot reach its backend (sidecar, cloud API). */
export class BrowserProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserProviderUnavailableError';
  }
}
