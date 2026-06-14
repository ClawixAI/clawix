import { describe, it, expect } from 'vitest';
import { createPkcePair, randomUrlToken, challengeFromVerifier } from '../oauth-pkce.js';

describe('oauth-pkce', () => {
  it('verifier is 43-128 url-safe chars', () => {
    const { codeVerifier } = createPkcePair();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
  });
  it('challenge is base64url SHA-256 of verifier, no padding', () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    expect(codeChallenge).toBe(challengeFromVerifier(codeVerifier));
    expect(codeChallenge).not.toContain('=');
    expect(codeChallenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
  it('randomUrlToken is unique and url-safe', () => {
    expect(randomUrlToken()).not.toBe(randomUrlToken());
    expect(randomUrlToken()).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});
