import { describe, it, expect } from 'vitest';
import { parseForm, policyFormSchema } from '../validation';

/**
 * Base of valid non-budget fields so each case isolates the `maxTokenBudget`
 * (USD dollars) field. Mirrors what `policyFormInput` pulls from the form —
 * all values are strings, as they arrive from FormData.
 */
const validBase = {
  name: 'Standard',
  description: '',
  maxAgents: '5',
  maxSkills: '5',
  maxGroupsOwned: '3',
  maxScheduledTasks: '10',
  minCronIntervalSecs: '60',
  maxTokensPerCronRun: '',
};

function parseBudget(maxTokenBudget: string) {
  return parseForm(policyFormSchema, { ...validBase, maxTokenBudget });
}

describe('policyFormSchema — maxTokenBudget (USD dollars)', () => {
  it('treats an empty string as unlimited', () => {
    const result = parseBudget('');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxTokenBudget).toBe('');
  });

  it('accepts a whole-dollar amount', () => {
    const result = parseBudget('5');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxTokenBudget).toBe(5);
  });

  it('accepts the smallest one-cent budget', () => {
    const result = parseBudget('0.01');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxTokenBudget).toBe(0.01);
  });

  it('accepts a two-decimal amount', () => {
    const result = parseBudget('12.34');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxTokenBudget).toBe(12.34);
  });

  it('accepts 0 (a block-everything budget)', () => {
    const result = parseBudget('0');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.maxTokenBudget).toBe(0);
  });

  it('rejects a negative amount', () => {
    const result = parseBudget('-1');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.fieldErrors['maxTokenBudget']).toMatch(/at least 0/);
  });

  it('rejects more than two decimal places', () => {
    const result = parseBudget('1.234');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.fieldErrors['maxTokenBudget']).toMatch(/decimal/i);
  });

  it('rejects a non-numeric value', () => {
    const result = parseBudget('abc');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.fieldErrors['maxTokenBudget']).toBeDefined();
  });
});
