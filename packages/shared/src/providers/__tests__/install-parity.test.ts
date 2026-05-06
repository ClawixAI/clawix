import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { listProviders } from '../provider-registry.js';

// scripts/install.mjs hand-mirrors the provider registry into its
// numbered prompt catalog. This test guards against drift: every
// non-custom provider in the registry must appear in the installer
// source by both `name` and `envKey`. Custom is handled by the
// "Custom" branch, so it is excluded.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const INSTALLER_PATH = resolve(REPO_ROOT, 'scripts/install.mjs');

describe('installer / provider-registry parity', () => {
  const installerSource = readFileSync(INSTALLER_PATH, 'utf8');
  const builtIns = listProviders().filter((p) => p.name !== 'custom');

  for (const provider of builtIns) {
    it(`installer references ${provider.name} by id`, () => {
      expect(installerSource).toContain(`id: '${provider.name}'`);
    });

    it(`installer references ${provider.name} envKey`, () => {
      expect(installerSource).toContain(`envKey: '${provider.envKey}'`);
    });
  }
});
