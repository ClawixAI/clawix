#!/usr/bin/env node
/**
 * Encrypt a secret using the same AES-256-GCM scheme as the API server.
 *
 * Usage:
 *   node scripts/encrypt-secret.mjs <plaintext>
 *   echo "my-secret" | node scripts/encrypt-secret.mjs
 *
 * Requires PROVIDER_ENCRYPTION_KEY in .env or environment.
 */
import { createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env without external dependencies
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not found — rely on environment variables
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  const keyHex = process.env['PROVIDER_ENCRYPTION_KEY'];
  if (!keyHex || keyHex.length !== 64) {
    console.error(
      'Error: PROVIDER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).\n' +
        'Generate one with: openssl rand -hex 32',
    );
    process.exit(1);
  }
  return Buffer.from(keyHex, 'hex');
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

// Read from argument or stdin
let plaintext = process.argv[2];

if (!plaintext) {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  plaintext = Buffer.concat(chunks).toString('utf8').trim();
}

if (!plaintext) {
  console.error('Usage: node scripts/encrypt-secret.mjs <plaintext>');
  process.exit(1);
}

console.log(encrypt(plaintext));
