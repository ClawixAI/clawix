import { describe, expect, it } from 'vitest';

import {
  systemSettingsIdentitySchema,
  updateSystemSettingsIdentitySchema,
  createPolicySchema,
  createUserSchema,
  paginationSchema,
  updatePolicySchema,
} from '../schemas/index.js';

describe('systemSettingsIdentitySchema', () => {
  it('should validate valid system settings identity', () => {
    const result = systemSettingsIdentitySchema.safeParse({
      name: 'Acme Corp',
      slug: 'acme-corp',
    });

    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = systemSettingsIdentitySchema.safeParse({
      name: '',
      slug: 'acme',
    });

    expect(result.success).toBe(false);
  });

  it('should reject invalid slug format', () => {
    const result = systemSettingsIdentitySchema.safeParse({
      name: 'Test',
      slug: 'Invalid Slug!',
    });

    expect(result.success).toBe(false);
  });

  it('should accept valid slug formats', () => {
    const validSlugs = ['acme', 'acme-corp', 'my-org-123'];

    for (const slug of validSlugs) {
      const result = systemSettingsIdentitySchema.safeParse({ name: 'Test', slug });
      expect(result.success).toBe(true);
    }
  });

  it('should default settings to empty object', () => {
    const result = systemSettingsIdentitySchema.safeParse({
      name: 'Test',
      slug: 'test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings).toEqual({});
    }
  });
});

describe('updateSystemSettingsIdentitySchema', () => {
  it('should allow partial updates', () => {
    const result = updateSystemSettingsIdentitySchema.safeParse({ name: 'New Name' });

    expect(result.success).toBe(true);
  });

  it('should allow empty object', () => {
    const result = updateSystemSettingsIdentitySchema.safeParse({});

    expect(result.success).toBe(true);
  });
});

describe('createPolicySchema', () => {
  it('should validate a valid policy with defaults', () => {
    const result = createPolicySchema.safeParse({ name: 'Standard' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxAgents).toBe(5);
      expect(result.data.maxSkills).toBe(10);
      expect(result.data.maxGroupsOwned).toBe(5);
      expect(result.data.allowedProviders).toEqual([]);
      expect(result.data.features).toEqual({});
    }
  });

  it('should accept optional fields', () => {
    const result = createPolicySchema.safeParse({
      name: 'Unrestricted',
      description: 'Full access',
      maxTokenBudget: 100000,
      maxAgents: 50,
      allowedProviders: ['anthropic', 'openai'],
    });

    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = createPolicySchema.safeParse({ name: '' });

    expect(result.success).toBe(false);
  });
});

describe('updatePolicySchema', () => {
  it('should allow partial updates', () => {
    const result = updatePolicySchema.safeParse({ maxAgents: 20 });

    expect(result.success).toBe(true);
  });
});

describe('createUserSchema', () => {
  it('should validate a valid user', () => {
    const result = createUserSchema.safeParse({
      email: 'user@example.com',
      name: 'Test User',
      password: 'securePass1!',
      role: 'developer',
      policyId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    });

    expect(result.success).toBe(true);
  });

  it('should reject invalid email', () => {
    const result = createUserSchema.safeParse({
      email: 'not-an-email',
      name: 'Test',
      role: 'developer',
      policyId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    });

    expect(result.success).toBe(false);
  });

  it('should reject invalid role', () => {
    const result = createUserSchema.safeParse({
      email: 'user@example.com',
      name: 'Test',
      role: 'superuser',
      policyId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    });

    expect(result.success).toBe(false);
  });

  it('should accept admin role (replaces tenant_admin)', () => {
    const result = createUserSchema.safeParse({
      email: 'admin@example.com',
      name: 'Admin',
      password: 'securePass1!',
      role: 'admin',
      policyId: 'clxxxxxxxxxxxxxxxxxxxxxxxxx',
    });

    expect(result.success).toBe(true);
  });
});

describe('paginationSchema', () => {
  it('should provide defaults', () => {
    const result = paginationSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('should coerce string values', () => {
    const result = paginationSchema.safeParse({ page: '3', limit: '50' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
    }
  });

  it('should reject limit over 100', () => {
    const result = paginationSchema.safeParse({ limit: 200 });

    expect(result.success).toBe(false);
  });
});
