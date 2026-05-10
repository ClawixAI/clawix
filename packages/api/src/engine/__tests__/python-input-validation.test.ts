import { describe, it, expect } from 'vitest';
import { validatePythonInput } from '../tools/python/input-validation';
import { PythonToolError } from '../tools/python/types';

describe('validatePythonInput', () => {
  it('accepts code only', () => {
    expect(() => validatePythonInput({ code: 'print(1)' })).not.toThrow();
  });

  it('accepts script only', () => {
    expect(() => validatePythonInput({ script: '/workspace/x.py' })).not.toThrow();
  });

  it('rejects both code and script', () => {
    expect(() => validatePythonInput({ code: 'print(1)', script: '/workspace/x.py' })).toThrowError(
      PythonToolError,
    );
  });

  it('rejects neither code nor script', () => {
    expect(() => validatePythonInput({})).toThrowError(PythonToolError);
  });

  it('rejects script paths that escape /workspace via ..', () => {
    expect(() => validatePythonInput({ script: '/workspace/../etc/passwd' })).toThrowError(
      PythonToolError,
    );
    expect(() => validatePythonInput({ script: '/workspace/sub/../../etc/passwd' })).toThrowError(
      PythonToolError,
    );
  });

  it('rejects script paths not ending in .py', () => {
    expect(() => validatePythonInput({ script: '/workspace/run.sh' })).toThrowError(
      PythonToolError,
    );
  });

  it('rejects package names with extras', () => {
    expect(() => validatePythonInput({ code: 'x', packages: ['requests[socks]'] })).toThrowError(
      PythonToolError,
    );
  });

  it('rejects package names with URL specs', () => {
    expect(() =>
      validatePythonInput({ code: 'x', packages: ['git+https://github.com/foo/bar'] }),
    ).toThrowError(PythonToolError);
  });

  it('accepts package names with version pins', () => {
    expect(() =>
      validatePythonInput({ code: 'x', packages: ['polars==0.20', 'scipy'] }),
    ).not.toThrow();
  });

  it('rejects empty package strings', () => {
    expect(() => validatePythonInput({ code: 'x', packages: [''] })).toThrowError(PythonToolError);
  });
});
