export interface PythonRunInput {
  code?: string;
  script?: string;
  packages?: string[];
  timeoutSecs?: number;
}

export interface PythonRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  isError: boolean;
  filesChanged: string[];
}

export type PythonToolErrorCode =
  | 'INVALID_INPUT'
  | 'SCRIPT_NOT_FOUND'
  | 'PACKAGE_NOT_ALLOWED'
  | 'INSTALL_FAILED'
  | 'EXEC_TIMEOUT'
  | 'OOM'
  | 'CANCELLED'
  | 'CONCURRENCY_LIMIT'
  | 'PROXY_UNAVAILABLE';

export class PythonToolError extends Error {
  constructor(
    public code: PythonToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PythonToolPolicy {
  allowPython: boolean;
  allowPythonNet: boolean;
  pythonPackageAllowlist: string[];
  maxPythonMemoryMb: number;
  maxPythonTimeoutSecs: number;
  maxPythonCpuCores: number;
  maxConcurrentPythonRuns: number;
}

export const PRE_BAKED_PACKAGES: ReadonlySet<string> = new Set([
  'pandas',
  'requests',
  'numpy',
  'httpx',
  'beautifulsoup4',
  'python-dateutil',
]);
