import { execFile as execFileCb } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ContainerRunner } from '../container-runner.js';
import {
  createEditFileTool,
  createListDirectoryTool,
  createReadFileTool,
  createWriteFileTool,
} from '../tools/file-io.js';
import { createShellTool } from '../tools/shell.js';
import type { Tool } from '../tool.js';

const execFile = promisify(execFileCb);

const AGENT_IMAGE = 'clawix-agent:test';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../../../');

// ------------------------------------------------------------------ //
//  Docker availability check                                          //
// ------------------------------------------------------------------ //

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFile('docker', ['info'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function isImageBuilt(): Promise<boolean> {
  try {
    const { stdout } = await execFile('docker', ['images', '-q', AGENT_IMAGE], { timeout: 5_000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function buildImage(): Promise<boolean> {
  try {
    await execFile(
      'docker',
      ['build', '-t', AGENT_IMAGE, '-f', 'infra/docker/agent/Dockerfile', '.'],
      { cwd: PROJECT_ROOT, timeout: 120_000 },
    );
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await isDockerAvailable();
const isCI = process.env['CI'] === 'true';

// Skip in CI - these tests require specific Docker setup with mounted volumes
// that may have permission issues in different CI environments
describe.skipIf(!dockerAvailable || isCI)('ContainerRunner integration', () => {
  let containerRunner: ContainerRunner;
  let containerId: string;
  let tmpDir: string;

  // Tools — instantiated after container starts
  let readFileTool: Tool;
  let writeFileTool: Tool;
  let editFileTool: Tool;
  let listDirTool: Tool;
  let shellTool: Tool;

  beforeAll(async () => {
    // Build image if needed
    const imageExists = await isImageBuilt();
    if (!imageExists) {
      const built = await buildImage();
      if (!built) {
        return;
      }
    }

    // Create temp directory for workspace mount
    tmpDir = await mkdtemp(path.join(tmpdir(), 'clawix-integration-'));

    // Start container via Docker CLI directly (bypass mount validation)
    const { stdout } = await execFile(
      'docker',
      [
        'run',
        '-d',
        '--name',
        `clawix-test-${Date.now()}`,
        '-v',
        `${tmpDir}:/workspace`,
        '--user',
        '1000:1000',
        AGENT_IMAGE,
      ],
      { timeout: 30_000 },
    );

    containerId = stdout.trim();

    // Instantiate ContainerRunner and tools
    containerRunner = new ContainerRunner();
    readFileTool = createReadFileTool(containerId, containerRunner);
    writeFileTool = createWriteFileTool(containerId, containerRunner);
    editFileTool = createEditFileTool(containerId, containerRunner);
    listDirTool = createListDirectoryTool(containerId, containerRunner);
    shellTool = createShellTool(containerId, containerRunner);
  }, 180_000);

  afterAll(async () => {
    if (containerId) {
      await execFile('docker', ['rm', '-f', containerId]).catch(() => {});
    }
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('executes a command and returns stdout', async () => {
    const result = await containerRunner.exec(containerId, ['echo', 'hello']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('sees host-mounted files inside the container', async () => {
    await writeFile(path.join(tmpDir, 'host-file.txt'), 'from host');
    const result = await containerRunner.exec(containerId, ['cat', '/workspace/host-file.txt']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('from host');
  });

  it('write_file tool writes content readable from host', async () => {
    const result = await writeFileTool.execute({
      path: '/workspace/test.txt',
      content: 'written by tool',
    });
    expect(result.isError).toBe(false);
    const hostContent = await readFile(path.join(tmpDir, 'test.txt'), 'utf-8');
    expect(hostContent).toBe('written by tool');
  });

  it('read_file tool reads content written by write_file', async () => {
    await writeFile(path.join(tmpDir, 'read-test.txt'), 'read me');
    const result = await readFileTool.execute({ path: '/workspace/read-test.txt' });
    expect(result.isError).toBe(false);
    expect(result.output).toBe('read me');
  });

  it('edit_file tool replaces text in a file', async () => {
    await writeFile(path.join(tmpDir, 'edit-test.txt'), 'hello world');
    const result = await editFileTool.execute({
      path: '/workspace/edit-test.txt',
      old_text: 'hello',
      new_text: 'goodbye',
    });
    expect(result.isError).toBe(false);
    const hostContent = await readFile(path.join(tmpDir, 'edit-test.txt'), 'utf-8');
    expect(hostContent).toBe('goodbye world');
  });

  it('list_directory tool lists workspace contents', async () => {
    await writeFile(path.join(tmpDir, 'listed.txt'), 'x');
    const result = await listDirTool.execute({ path: '/workspace' });
    expect(result.isError).toBe(false);
    expect(result.output).toContain('listed.txt');
  });

  it('shell tool executes commands inside the container', async () => {
    await writeFile(path.join(tmpDir, 'shell-test.txt'), 'shell content');
    const result = await shellTool.execute({ command: 'ls /workspace' });
    expect(result.isError).toBe(false);
    expect(result.output).toContain('shell-test.txt');
  });

  it('read_file tool blocks path traversal', async () => {
    const result = await readFileTool.execute({ path: '../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.output).toContain('outside the allowed directories');
  });
});
