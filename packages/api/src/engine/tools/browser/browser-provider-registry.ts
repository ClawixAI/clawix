import { Injectable } from '@nestjs/common';
import { createLogger } from '@clawix/shared';

import type { BrowserProvider } from './browser-provider.js';

const logger = createLogger('engine:tools:browser:registry');

@Injectable()
export class BrowserProviderRegistry {
  private readonly providers = new Map<string, BrowserProvider>();
  private active: BrowserProvider | null = null;

  register(provider: BrowserProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Pick the active provider based on BROWSER_PROVIDER env (default "local").
   * Throws if the configured provider was not previously registered.
   */
  activate(): void {
    const name = (process.env['BROWSER_PROVIDER'] ?? 'local').toLowerCase();
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `unknown provider "${name}"; registered: [${[...this.providers.keys()].join(', ')}]`,
      );
    }
    this.active = provider;
    logger.info({ provider: name }, 'BrowserProvider activated');
  }

  disable(): void {
    if (this.active) {
      logger.warn({ provider: this.active.name }, 'BrowserProvider disabled');
    }
    this.active = null;
  }

  getActive(): BrowserProvider | null {
    return this.active;
  }
}
