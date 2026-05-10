import { describe, it, expect, afterEach } from 'vitest';
import { BrowserProviderRegistry } from './browser-provider-registry.js';
import { MockBrowserProvider } from './__tests__/mock-browser-provider.js';

describe('BrowserProviderRegistry', () => {
  const ORIGINAL = process.env['BROWSER_PROVIDER'];

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env['BROWSER_PROVIDER'];
    else process.env['BROWSER_PROVIDER'] = ORIGINAL;
  });

  it('selects the registered provider matching BROWSER_PROVIDER env', () => {
    process.env['BROWSER_PROVIDER'] = 'mock';
    const reg = new BrowserProviderRegistry();
    reg.register(new MockBrowserProvider());

    reg.activate();

    expect(reg.getActive()?.name).toBe('mock');
  });

  it('defaults to "local" when BROWSER_PROVIDER is unset', () => {
    delete process.env['BROWSER_PROVIDER'];
    const reg = new BrowserProviderRegistry();
    const mockNamedLocal: any = new MockBrowserProvider();
    Object.defineProperty(mockNamedLocal, 'name', { value: 'local' });
    reg.register(mockNamedLocal);

    reg.activate();

    expect(reg.getActive()?.name).toBe('local');
  });

  it('throws on activation when the configured provider is unregistered', () => {
    process.env['BROWSER_PROVIDER'] = 'unknown';
    const reg = new BrowserProviderRegistry();

    expect(() => reg.activate()).toThrow(/unknown provider/i);
  });

  it('disable() detaches the active provider so tools can refuse to register', () => {
    process.env['BROWSER_PROVIDER'] = 'mock';
    const reg = new BrowserProviderRegistry();
    reg.register(new MockBrowserProvider());
    reg.activate();

    reg.disable();

    expect(reg.getActive()).toBeNull();
  });
});
