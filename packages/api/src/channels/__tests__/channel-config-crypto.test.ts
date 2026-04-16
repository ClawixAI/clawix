import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  encryptChannelConfig,
  decryptChannelConfig,
  maskChannelConfig,
} from '../channel-config-crypto.js';

const TEST_KEY_HEX = 'a'.repeat(64);

describe('channel-config-crypto', () => {
  beforeEach(() => {
    vi.stubEnv('PROVIDER_ENCRYPTION_KEY', TEST_KEY_HEX);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('encrypts and decrypts sensitive telegram keys round-trip', () => {
    const config = {
      bot_token: 'my-secret-token',
      webhook_secret: 'wh-secret-123',
      mode: 'polling',
    };

    const encrypted = encryptChannelConfig('telegram', config);

    // Sensitive keys should be encrypted
    expect(encrypted['bot_token']).not.toBe('my-secret-token');
    expect(encrypted['webhook_secret']).not.toBe('wh-secret-123');
    // Non-sensitive keys stay as-is
    expect(encrypted['mode']).toBe('polling');

    // Decrypt round-trip
    const decrypted = decryptChannelConfig('telegram', encrypted);
    expect(decrypted['bot_token']).toBe('my-secret-token');
    expect(decrypted['webhook_secret']).toBe('wh-secret-123');
    expect(decrypted['mode']).toBe('polling');
  });

  it('does not mutate the original config', () => {
    const config = { bot_token: 'secret', mode: 'polling' };
    const encrypted = encryptChannelConfig('telegram', config);

    expect(config.bot_token).toBe('secret');
    expect(encrypted).not.toBe(config);
  });

  it('skips empty string values', () => {
    const config = { bot_token: '', mode: 'polling' };
    const encrypted = encryptChannelConfig('telegram', config);

    expect(encrypted['bot_token']).toBe('');
  });

  it('passes through config for unknown channel types', () => {
    const config = { some_key: 'value' };
    const encrypted = encryptChannelConfig('unknown', config);

    expect(encrypted['some_key']).toBe('value');
  });

  it('masks sensitive fields for display', () => {
    const config = {
      bot_token: 'my-very-long-secret-token-12345',
      mode: 'polling',
    };

    const masked = maskChannelConfig('telegram', config);

    expect(masked['bot_token']).toBe('sk-***...2345');
    expect(masked['mode']).toBe('polling');
  });

  it('masks short tokens as ****', () => {
    const config = { bot_token: 'short' };
    const masked = maskChannelConfig('telegram', config);

    expect(masked['bot_token']).toBe('****');
  });

  it('handles web channel type with no sensitive keys', () => {
    const config = { enableProgress: true, enableToolHints: false };
    const encrypted = encryptChannelConfig('web', config);

    expect(encrypted).toEqual(config);
  });
});
