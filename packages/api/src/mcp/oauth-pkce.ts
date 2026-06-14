import { createHash, randomBytes } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 S256 challenge for a given verifier. */
export function challengeFromVerifier(codeVerifier: string): string {
  return base64url(createHash('sha256').update(codeVerifier).digest());
}

/** A PKCE verifier (96 random bytes → ~128 url-safe chars) + its S256 challenge. */
export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(96)).slice(0, 128);
  return { codeVerifier, codeChallenge: challengeFromVerifier(codeVerifier) };
}

/** A url-safe random token for `state` (single-use CSRF guard). */
export function randomUrlToken(): string {
  return base64url(randomBytes(32));
}
