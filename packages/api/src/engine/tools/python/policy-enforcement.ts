import { PythonRunInput, PythonToolError, PythonToolPolicy, PRE_BAKED_PACKAGES } from './types.js';

function packageName(spec: string): string {
  const eq = spec.indexOf('==');
  return (eq === -1 ? spec : spec.slice(0, eq)).toLowerCase();
}

export function enforcePythonPolicy(input: PythonRunInput, policy: PythonToolPolicy): void {
  if (input.packages && input.packages.length > 0) {
    const allowed = new Set(policy.pythonPackageAllowlist.map((s: string) => s.toLowerCase()));
    for (const baked of PRE_BAKED_PACKAGES) allowed.add(baked);
    for (const spec of input.packages) {
      const name = packageName(spec);
      if (!allowed.has(name)) {
        const sample = Array.from(allowed).slice(0, 10).join(', ');
        throw new PythonToolError(
          'PACKAGE_NOT_ALLOWED',
          `Error: package '${name}' is not on your allowlist. Allowed: [${sample}${allowed.size > 10 ? ', ...' : ''}].`,
        );
      }
    }
  }
  if (input.timeoutSecs !== undefined && input.timeoutSecs > policy.maxPythonTimeoutSecs) {
    throw new PythonToolError(
      'INVALID_INPUT',
      `Error: timeoutSecs (${input.timeoutSecs}) exceeds policy max (${policy.maxPythonTimeoutSecs}).`,
    );
  }
}
