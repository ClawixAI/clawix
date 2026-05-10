import { describe, it, expect } from 'vitest';
import { enforcePythonPolicy } from '../tools/python/policy-enforcement';
import { PythonToolError, type PythonToolPolicy } from '../tools/python/types';

const basePolicy: PythonToolPolicy = {
  allowPython: true,
  allowPythonNet: false,
  pythonPackageAllowlist: ['polars', 'scipy'],
  maxPythonMemoryMb: 512,
  maxPythonTimeoutSecs: 60,
  maxPythonCpuCores: 1,
  maxConcurrentPythonRuns: 2,
};

describe('enforcePythonPolicy', () => {
  it('accepts pre-baked packages', () => {
    expect(() =>
      enforcePythonPolicy({ code: 'x', packages: ['pandas'] }, basePolicy),
    ).not.toThrow();
  });

  it('accepts allowlisted extras', () => {
    expect(() =>
      enforcePythonPolicy({ code: 'x', packages: ['polars==0.20'] }, basePolicy),
    ).not.toThrow();
  });

  it('rejects non-allowlisted packages', () => {
    expect(() =>
      enforcePythonPolicy({ code: 'x', packages: ['yfinance'] }, basePolicy),
    ).toThrowError(PythonToolError);
  });

  it('strips version pin when checking allowlist', () => {
    expect(() =>
      enforcePythonPolicy({ code: 'x', packages: ['polars==9.99'] }, basePolicy),
    ).not.toThrow();
  });

  it('rejects timeoutSecs above policy max', () => {
    expect(() => enforcePythonPolicy({ code: 'x', timeoutSecs: 120 }, basePolicy)).toThrowError(
      PythonToolError,
    );
  });

  it('accepts timeoutSecs at policy max', () => {
    expect(() => enforcePythonPolicy({ code: 'x', timeoutSecs: 60 }, basePolicy)).not.toThrow();
  });

  it('lists allowed packages in error message', () => {
    try {
      enforcePythonPolicy({ code: 'x', packages: ['yfinance'] }, basePolicy);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as PythonToolError).message).toMatch(/Allowed:/);
      expect((err as PythonToolError).message).toMatch(/polars/);
    }
  });
});
