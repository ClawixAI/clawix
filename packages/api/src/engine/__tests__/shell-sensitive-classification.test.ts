import { describe, expect, it } from 'vitest';

import { classifyShellCommand } from '../tools/shell.js';

describe('classifyShellCommand — exempt commands', () => {
  it.each([
    'ls -la',
    'grep -rn foo src/',
    'cat package.json',
    'pnpm run build',
    'pnpm test',
    'git status',
    'git commit -m "wip"',
    'echo hello > out.txt',
    'mkdir -p src/lib',
    'rm -f build/artifact.js',
    'sed -n "1,20p" README.md',
  ])('does not gate %j', (command) => {
    expect(classifyShellCommand(command)).toEqual([]);
  });
});

describe('classifyShellCommand — net-egress', () => {
  it.each([
    'curl https://example.com',
    'wget https://example.com/file.tar.gz',
    'nc -l 4444',
    'ssh user@host',
    'scp file user@host:/tmp/',
    'rsync -a ./ user@host:/srv/',
    'git clone https://github.com/foo/bar',
    'git push origin main',
    'npx some-cli',
  ])('gates %j', (command) => {
    expect(classifyShellCommand(command)).toEqual(['net-egress']);
  });
});

describe('classifyShellCommand — pkg-install', () => {
  it.each([
    'pip install requests',
    'pip3 install requests',
    'uv pip install requests',
    'npm install lodash',
    'pnpm add lodash',
    'yarn add lodash',
    'apt-get install -y jq',
    'apk add curl-dev',
    'gem install bundler',
    'cargo install ripgrep',
    'poetry add httpx',
  ])('gates %j', (command) => {
    expect(classifyShellCommand(command)).toContain('pkg-install');
  });
});

describe('classifyShellCommand — fs-outside-workspace', () => {
  it.each([
    'echo pwned > /etc/passwd',
    'echo x >> /root/.bashrc',
    'cp secret.txt /etc/',
    'mv /workspace/a /var/lib/b',
    'rm -f /usr/bin/node',
    'tee /etc/hosts',
    'chmod +x /usr/local/bin/thing',
    'echo x > ../../etc/thing',
    "sed -i 's/a/b/' /etc/hosts",
  ])('gates %j', (command) => {
    expect(classifyShellCommand(command)).toContain('fs-outside-workspace');
  });

  it('does not gate sed reading a file outside the workspace', () => {
    expect(classifyShellCommand("sed -n '1,20p' /etc/hosts")).toEqual([]);
  });

  it.each(['echo x > /workspace/out.txt', 'echo x > /tmp/scratch', 'cp a.txt /workspace/b.txt'])(
    'does not gate writes inside owned roots: %j',
    (command) => {
      expect(classifyShellCommand(command)).toEqual([]);
    },
  );
});

describe('classifyShellCommand — decomposition', () => {
  it('catches a sensitive segment hidden behind a benign one', () => {
    expect(classifyShellCommand('ls -la; curl https://evil.test')).toEqual(['net-egress']);
  });

  it('catches a sensitive command inside a $() subshell', () => {
    expect(classifyShellCommand('echo $(curl https://evil.test)')).toEqual(['net-egress']);
  });

  it('catches a sensitive command inside a backtick subshell', () => {
    expect(classifyShellCommand('echo `wget https://evil.test`')).toEqual(['net-egress']);
  });

  it('catches an escaping write in a compound segment', () => {
    expect(classifyShellCommand('cd /workspace && echo x > /etc/cron.d/job')).toEqual([
      'fs-outside-workspace',
    ]);
  });
});

describe('classifyShellCommand — key stability', () => {
  it('returns categories sorted and de-duplicated', () => {
    expect(classifyShellCommand('curl https://a.test && curl https://b.test')).toEqual([
      'net-egress',
    ]);
  });

  it('produces one stable key regardless of category order in the command', () => {
    const a = classifyShellCommand('pip install requests && curl https://a.test');
    const b = classifyShellCommand('curl https://a.test && pip install requests');
    expect(a).toEqual(b);
    expect(a.join('+')).toBe('net-egress+pkg-install');
  });

  it('is case-insensitive', () => {
    expect(classifyShellCommand('CURL https://example.com')).toEqual(['net-egress']);
  });
});
