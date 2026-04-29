import { encrypt, decrypt, maskApiKey } from '../common/crypto.js';

/**
 * Keys in channel config that contain secrets and must be encrypted at rest.
 * Keyed by channel type; keys not listed here are stored as plaintext.
 */
const SENSITIVE_KEYS: Readonly<Record<string, readonly string[]>> = {
  telegram: ['bot_token', 'webhook_secret'],
  slack: ['bot_token', 'signing_secret'],
};

function getSensitiveKeys(channelType: string): readonly string[] {
  return SENSITIVE_KEYS[channelType] ?? [];
}

/**
 * Encrypt sensitive fields in a channel config object before persisting.
 * Returns a new object — the original is not mutated.
 */
export function encryptChannelConfig(
  channelType: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const sensitiveKeys = getSensitiveKeys(channelType);
  if (sensitiveKeys.length === 0) return { ...config };

  const result = { ...config };
  for (const key of sensitiveKeys) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0) {
      result[key] = encrypt(value);
    }
  }
  return result;
}

/**
 * Decrypt sensitive fields in a channel config object after reading from DB.
 * Returns a new object — the original is not mutated.
 */
export function decryptChannelConfig(
  channelType: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const sensitiveKeys = getSensitiveKeys(channelType);
  if (sensitiveKeys.length === 0) return { ...config };

  const result = { ...config };
  for (const key of sensitiveKeys) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0) {
      result[key] = decrypt(value);
    }
  }
  return result;
}

/**
 * Mask sensitive fields for display (e.g. API responses to the web UI).
 * Returns a new object — the original is not mutated.
 */
export function maskChannelConfig(
  channelType: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const sensitiveKeys = getSensitiveKeys(channelType);
  if (sensitiveKeys.length === 0) return { ...config };

  const result = { ...config };
  for (const key of sensitiveKeys) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0) {
      result[key] = maskApiKey(value);
    }
  }
  return result;
}
