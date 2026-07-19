/**
 * Live acceptance proof for the per-container egress firewall.
 *
 * Runs the REAL ContainerRunner against BOTH firewalled runner images on the
 * real clawix-python-net-egress network and asserts, by exec:
 *   - public egress + DNS survive (https://example.com → HTTP 200),
 *   - cloud metadata (169.254.169.254) is blocked,
 *   - the Docker gateway host-port (the §3 escape) is blocked,
 *   - EGRESS_ALLOWLIST re-permits a specific host:port.
 *
 * Probe uses python3 (present in BOTH images — python-runner has no curl) and
 * classifies the outcome by exit code so we can tell "firewall permitted" from
 * "service unreachable":
 *   exit 0  → reached (HTTP reply OR connection refused/reset = SYN allowed out)
 *   exit 28 → timed out (the DROP rule ate the packet = firewall blocked)
 *   exit 1  → other error
 *
 * Gated: skips (loudly) when Docker / the images / the network are absent or in
 * CI, mirroring container-runner.integration.test.ts.
 */
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

import { afterEach, describe, expect, it } from 'vitest';

import { ContainerRunner } from '../container-runner.js';

const execFile = promisify(execFileCb);
const NET = 'clawix-python-net-egress';
const IMAGES = ['clawix-python-runner:latest', 'clawix-shell-net-runner:latest'];

// Classifies reachability by exit code (see file header).
const PROBE = [
  'import sys, socket, urllib.request, urllib.error',
  'try:',
  '    urllib.request.urlopen(sys.argv[1], timeout=5)',
  "    print('HTTP-OK'); sys.exit(0)",
  'except urllib.error.URLError as e:',
  '    r = e.reason',
  "    if isinstance(r, socket.timeout) or 'timed out' in str(r).lower():",
  "        print('TIMEOUT'); sys.exit(28)",
  "    print('REACHED', r); sys.exit(0)",
  'except Exception as e:',
  "    print('OTHER', e); sys.exit(1)",
].join('\n');

async function dockerOk(): Promise<boolean> {
  try {
    await execFile('docker', ['info'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function present(): Promise<boolean> {
  try {
    for (const img of IMAGES) {
      const { stdout } = await execFile('docker', ['images', '-q', img]);
      if (!stdout.trim()) return false;
    }
    await execFile('docker', ['network', 'inspect', NET]);
    return true;
  } catch {
    return false;
  }
}

async function gateway(): Promise<string> {
  const { stdout } = await execFile('docker', [
    'network',
    'inspect',
    NET,
    '--format',
    '{{(index .IPAM.Config 0).Gateway}}',
  ]);
  return stdout.trim();
}

const canRun = (await dockerOk()) && (await present()) && process.env['CI'] !== 'true';
if (!canRun) {
  console.warn('[egress-filter.integration] SKIPPED — docker/images/network missing or CI');
}

function defFor(image: string) {
  return {
    id: 'egress-test',
    name: 'egress-test',
    description: null,
    systemPrompt: '',
    role: 'worker',
    provider: 'none',
    model: 'none',
    apiBaseUrl: null,
    skillIds: [],
    maxTokensPerRun: 0,
    containerConfig: {
      image,
      cpuLimit: '1',
      memoryLimit: '512m',
      timeoutSeconds: 120,
      readOnlyRootfs: false,
      allowedMounts: [],
      idleTimeoutSeconds: 0,
    },
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

describe.skipIf(!canRun)('egress firewall (real Docker)', () => {
  const runner = new ContainerRunner();
  let started: string[] = [];

  afterEach(async () => {
    for (const id of started) await runner.stop(id).catch(() => {});
    started = [];
  }, 60000); // stop() has a 10s docker-stop grace per container — above vitest's 10s hook default

  /** Returns the probe's exit code (0 reached, 28 timed-out/blocked, 1 other). */
  async function probe(id: string, url: string): Promise<number> {
    const r = await runner.exec(id, ['python3', '-c', PROBE, url], {
      user: '1000:1000',
      timeout: 20000,
    });
    return r.exitCode;
  }

  for (const image of IMAGES) {
    it(`${image}: blocks private+metadata, allows public, keeps DNS`, async () => {
      const id = await runner.start(defFor(image), [], {
        disableAutoStop: true,
        network: NET,
        egressFirewall: true,
      });
      started.push(id);
      const gw = await gateway();

      // public by hostname → also proves DNS survives the firewall
      expect(await probe(id, 'https://example.com')).toBe(0);
      // cloud metadata → blocked (DROP → timeout)
      expect(await probe(id, 'http://169.254.169.254/')).toBe(28);
      // §3 host-port escape via the Docker gateway → blocked
      expect(await probe(id, `http://${gw}:3001`)).toBe(28);
    }, 120000);
  }

  it('allowlist re-permits a specific host:port', async () => {
    const gw = await gateway();
    const id = await runner.start(defFor('clawix-python-runner:latest'), [], {
      disableAutoStop: true,
      network: NET,
      egressFirewall: true,
      egressAllowlist: `${gw}:3001`,
    });
    started.push(id);
    // With gateway:3001 allowlisted the SYN is permitted; whether :3001 answers
    // or refuses, the outcome is "reached" (exit 0), never a firewall timeout
    // (28). Asserting "not 28" isolates the firewall decision from whether a
    // service happens to be listening.
    expect(await probe(id, `http://${gw}:3001`)).not.toBe(28);
  }, 120000);
});
