import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate an RFC 4122 v4 UUID.
 *
 * Uses native `crypto.randomUUID()` when available (HTTPS / localhost / Node).
 * Falls back to a `crypto.getRandomValues()` implementation in non-secure
 * contexts (plain HTTP), where `randomUUID` is gated by the secure-context
 * restriction but `getRandomValues` is not.
 */
export function uuidv4(): string {
  const c = globalThis.crypto;
  if (!c) {
    throw new Error('Web Crypto API is not available in this environment');
  }
  if (typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (ch) => {
    const n = Number(ch);
    const byte = c.getRandomValues(new Uint8Array(1))[0] ?? 0;
    const r = byte & (15 >> (n / 4));
    return (n ^ r).toString(16);
  });
}
