import path from 'node:path';
import { PythonRunInput, PythonToolError } from './types.js';

const PACKAGE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*(==[\w.+-]+)?$/;

export function validatePythonInput(input: PythonRunInput): void {
  const hasCode = typeof input.code === 'string' && input.code.length > 0;
  const hasScript = typeof input.script === 'string' && input.script.length > 0;

  if (hasCode === hasScript) {
    throw new PythonToolError('INVALID_INPUT', "Error: provide exactly one of 'code' or 'script'.");
  }

  if (hasScript) {
    const resolved = path.resolve('/workspace', input.script!);
    if (!resolved.startsWith('/workspace/') && resolved !== '/workspace') {
      throw new PythonToolError(
        'INVALID_INPUT',
        `Error: script path '${input.script}' escapes /workspace.`,
      );
    }
    if (!resolved.toLowerCase().endsWith('.py')) {
      throw new PythonToolError('INVALID_INPUT', 'Error: script path must end in .py.');
    }
  }

  if (input.packages) {
    for (const pkg of input.packages) {
      if (!pkg || !PACKAGE_RE.test(pkg)) {
        throw new PythonToolError(
          'INVALID_INPUT',
          `Error: package name '${pkg}' is invalid (allowed format: name or name==version).`,
        );
      }
    }
  }

  if (
    input.timeoutSecs !== undefined &&
    (input.timeoutSecs < 1 || !Number.isInteger(input.timeoutSecs))
  ) {
    throw new PythonToolError('INVALID_INPUT', 'Error: timeoutSecs must be a positive integer.');
  }
}
