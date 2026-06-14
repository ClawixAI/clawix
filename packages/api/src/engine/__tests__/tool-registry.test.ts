import { describe, expect, it } from 'vitest';

import { ToolRegistry } from '../tool-registry.js';
import type { Tool } from '../tool.js';

/** Helper to create a stub tool. */
function createTool(name: string, overrides?: Partial<Pick<Tool, 'parameters' | 'execute'>>): Tool {
  return {
    name,
    description: `Description for ${name}`,
    parameters: overrides?.parameters ?? {
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
    },
    execute: overrides?.execute ?? (async () => ({ output: 'ok', isError: false })),
  };
}

describe('ToolRegistry — registration + schema generation', () => {
  it('registers a tool and retrieves it by name', () => {
    const registry = new ToolRegistry();
    const tool = createTool('search');

    registry.register(tool);

    expect(registry.has('search')).toBe(true);
    expect(registry.get('search')).toBe(tool);
  });

  it('returns false/undefined for unregistered tools', () => {
    const registry = new ToolRegistry();

    expect(registry.has('missing')).toBe(false);
    expect(registry.get('missing')).toBeUndefined();
  });

  it('overwrites duplicate registrations', () => {
    const registry = new ToolRegistry();
    const tool1 = createTool('dup');
    const tool2 = createTool('dup');

    registry.register(tool1);
    registry.register(tool2);

    expect(registry.get('dup')).toBe(tool2);
  });

  it('getDefinitions returns ToolDefinition[] for all registered tools', () => {
    const registry = new ToolRegistry();
    registry.register(createTool('alpha'));
    registry.register(createTool('beta'));

    const defs = registry.getDefinitions();

    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.name).sort()).toEqual(['alpha', 'beta']);
    for (const def of defs) {
      expect(def).toHaveProperty('name');
      expect(def).toHaveProperty('description');
      expect(def).toHaveProperty('inputSchema');
    }
  });

  it('getDefinitions returns empty array when no tools registered', () => {
    const registry = new ToolRegistry();
    expect(registry.getDefinitions()).toEqual([]);
  });
});

describe('ToolRegistry — parameter validation', () => {
  it('returns empty errors for valid params', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
      }),
    );

    const errors = registry.validateParams('t', { name: 'Alice' });
    expect(errors).toEqual([]);
  });

  it('returns error for missing required param', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' }, age: { type: 'integer' } },
          required: ['name', 'age'],
        },
      }),
    );

    const errors = registry.validateParams('t', { name: 'Alice' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('age');
  });

  it('returns error for wrong type', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { count: { type: 'integer' } },
        },
      }),
    );

    const errors = registry.validateParams('t', { count: 'not-a-number' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('count');
  });

  it('returns error for enum violation', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { color: { type: 'string', enum: ['red', 'blue'] } },
        },
      }),
    );

    const errors = registry.validateParams('t', { color: 'green' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('color');
  });

  it('returns error for numeric min/max violation', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { age: { type: 'integer', minimum: 0, maximum: 150 } },
        },
      }),
    );

    expect(registry.validateParams('t', { age: -1 })[0]).toContain('age');
    expect(registry.validateParams('t', { age: 200 })[0]).toContain('age');
    expect(registry.validateParams('t', { age: 25 })).toEqual([]);
  });

  it('returns error for string length violation', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { code: { type: 'string', minLength: 2, maxLength: 5 } },
        },
      }),
    );

    expect(registry.validateParams('t', { code: 'a' })[0]).toContain('code');
    expect(registry.validateParams('t', { code: 'abcdef' })[0]).toContain('code');
    expect(registry.validateParams('t', { code: 'abc' })).toEqual([]);
  });

  it('returns error for nested object validation', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: {
            address: {
              type: 'object',
              properties: {
                zip: { type: 'string', minLength: 5 },
                city: { type: 'string' },
              },
              required: ['zip'],
            },
          },
        },
      }),
    );

    // Missing nested required field
    const errors1 = registry.validateParams('t', { address: {} });
    expect(errors1.length).toBeGreaterThan(0);
    expect(errors1[0]).toContain('address.zip');

    // Nested constraint violation
    const errors2 = registry.validateParams('t', { address: { zip: 'ab' } });
    expect(errors2.length).toBeGreaterThan(0);
    expect(errors2[0]).toContain('address.zip');

    // Valid nested object
    expect(registry.validateParams('t', { address: { zip: '12345' } })).toEqual([]);
  });

  it('returns error for unknown tool', () => {
    const registry = new ToolRegistry();
    const errors = registry.validateParams('nope', {});
    expect(errors).toEqual(['Tool not found: nope']);
  });
});

describe('ToolRegistry — parameter casting', () => {
  it('casts string to integer', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { count: { type: 'integer' } },
        },
      }),
    );

    const result = registry.castParams('t', { count: '42' });
    expect(result['count']).toBe(42);
  });

  it('casts string to number (float)', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { price: { type: 'number' } },
        },
      }),
    );

    const result = registry.castParams('t', { price: '3.14' });
    expect(result['price']).toBeCloseTo(3.14);
  });

  it('casts string to boolean', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { flag: { type: 'boolean' } },
        },
      }),
    );

    expect(registry.castParams('t', { flag: 'true' })['flag']).toBe(true);
    expect(registry.castParams('t', { flag: '1' })['flag']).toBe(true);
    expect(registry.castParams('t', { flag: 'yes' })['flag']).toBe(true);
    expect(registry.castParams('t', { flag: 'false' })['flag']).toBe(false);
    expect(registry.castParams('t', { flag: '0' })['flag']).toBe(false);
    expect(registry.castParams('t', { flag: 'no' })['flag']).toBe(false);
  });

  it('returns params unchanged for unknown tool', () => {
    const registry = new ToolRegistry();
    const params = { a: 1, b: 'two' };
    expect(registry.castParams('nope', params)).toEqual(params);
  });

  it('does not mutate original params', () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { count: { type: 'integer' } },
        },
      }),
    );

    const original = { count: '5' };
    const casted = registry.castParams('t', original);
    expect(original.count).toBe('5');
    expect(casted['count']).toBe(5);
  });
});

describe('ToolRegistry — execute', () => {
  it('executes a tool and returns its output', async () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('echo', {
        parameters: { type: 'object', properties: { msg: { type: 'string' } } },
        execute: async (params) => ({ output: String(params['msg']), isError: false }),
      }),
    );

    const result = await registry.execute('echo', { msg: 'hello' });
    expect(result.output).toBe('hello');
    expect(result.isError).toBe(false);
  });

  it('returns error for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute('missing', {});
    expect(result.isError).toBe(true);
    expect(result.output).toContain('missing');
  });

  it('casts params before validation (string "5" → int 5)', async () => {
    const registry = new ToolRegistry();
    let receivedCount: unknown;
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { count: { type: 'integer' } },
          required: ['count'],
        },
        execute: async (params) => {
          receivedCount = params['count'];
          return { output: 'ok', isError: false };
        },
      }),
    );

    const result = await registry.execute('t', { count: '5' });
    expect(result.isError).toBe(false);
    expect(receivedCount).toBe(5);
  });

  it('returns validation errors without executing', async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        },
        execute: async () => {
          executed = true;
          return { output: 'ok', isError: false };
        },
      }),
    );

    const result = await registry.execute('t', {});
    expect(result.isError).toBe(true);
    expect(result.output).toContain('name');
    expect(executed).toBe(false);
  });

  it('appends error hint to error results', async () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('fail', {
        parameters: { type: 'object' },
        execute: async () => ({ output: 'Something went wrong', isError: true }),
      }),
    );

    const result = await registry.execute('fail', {});
    expect(result.isError).toBe(true);
    expect(result.output).toContain('Something went wrong');
    expect(result.output).toContain('[Analyze the error above and try a different approach.]');
  });

  it('catches exceptions and returns error result', async () => {
    const registry = new ToolRegistry();
    registry.register(
      createTool('boom', {
        parameters: { type: 'object' },
        execute: async () => {
          throw new Error('kaboom');
        },
      }),
    );

    const result = await registry.execute('boom', {});
    expect(result.isError).toBe(true);
    expect(result.output).toContain('kaboom');
  });

  it('truncates output over maxOutputChars', async () => {
    const registry = new ToolRegistry(50);
    registry.register(
      createTool('big', {
        parameters: { type: 'object' },
        execute: async () => ({ output: 'x'.repeat(100), isError: false }),
      }),
    );

    const result = await registry.execute('big', {});
    expect(result.output.length).toBeLessThan(100);
    expect(result.output).toContain('... (truncated)');
  });

  it('strips unknown params before executing (additional properties)', async () => {
    const registry = new ToolRegistry();
    let receivedParams: Record<string, unknown> = {};
    registry.register(
      createTool('t', {
        parameters: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        execute: async (params) => {
          receivedParams = params;
          return { output: 'ok', isError: false };
        },
      }),
    );

    await registry.execute('t', { name: 'Alice', injected: 'evil' });
    expect(receivedParams).toEqual({ name: 'Alice' });
    expect(receivedParams).not.toHaveProperty('injected');
  });

  it('does not truncate output under maxOutputChars', async () => {
    const registry = new ToolRegistry(200);
    registry.register(
      createTool('small', {
        parameters: { type: 'object' },
        execute: async () => ({ output: 'short', isError: false }),
      }),
    );

    const result = await registry.execute('small', {});
    expect(result.output).toBe('short');
  });
});

describe('ToolRegistry — execute with rawParams', () => {
  it('passes params verbatim: unknown keys preserved, no coercion', async () => {
    const registry = new ToolRegistry();
    let received: Record<string, unknown> = {};
    registry.register({
      name: 'raw',
      description: 'raw passthrough',
      parameters: {
        type: 'object',
        properties: { flag: { type: 'boolean' }, count: { type: 'integer' } },
      },
      rawParams: true,
      async execute(params) {
        received = params;
        return { output: 'ok', isError: false };
      },
    });

    const result = await registry.execute('raw', {
      flag: 'true', // would normally coerce to boolean true
      count: '5', // would normally coerce to int 5
      extra: 'kept', // would normally be stripped (not in schema)
    });

    expect(result.isError).toBe(false);
    expect(received).toEqual({ flag: 'true', count: '5', extra: 'kept' });
  });

  it('does not reject schema-violating args — execute still runs', async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      name: 'raw',
      description: 'raw',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      rawParams: true,
      async execute() {
        executed = true;
        return { output: 'ok', isError: false };
      },
    });

    // 'name' is required + must be a string; pass a number and omit nothing —
    // strict validation would reject, rawParams must let it through.
    const result = await registry.execute('raw', { name: 123 });
    expect(executed).toBe(true);
    expect(result.isError).toBe(false);
    expect(result.output).not.toContain('Invalid type');
  });

  it('still truncates output over maxOutputChars', async () => {
    const registry = new ToolRegistry(50);
    registry.register({
      name: 'rawbig',
      description: 'raw big',
      parameters: { type: 'object' },
      rawParams: true,
      async execute() {
        return { output: 'x'.repeat(20_000), isError: false };
      },
    });

    const result = await registry.execute('rawbig', {});
    expect(result.output.length).toBeLessThan(20_000);
    expect(result.output).toContain('... (truncated)');
  });

  it('still appends the error hint to error results', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'rawfail',
      description: 'raw fail',
      parameters: { type: 'object' },
      rawParams: true,
      async execute() {
        return { output: 'boom', isError: true };
      },
    });

    const result = await registry.execute('rawfail', {});
    expect(result.isError).toBe(true);
    expect(result.output).toContain('boom');
    expect(result.output).toContain('[Analyze the error above and try a different approach.]');
  });
});

describe('execute with abortSignal context', () => {
  it('forwards ctx.abortSignal to the tool', async () => {
    const registry = new ToolRegistry();
    const seen: AbortSignal[] = [];

    registry.register({
      name: 'capture',
      description: '',
      parameters: { type: 'object', properties: {} },
      async execute(_params, ctx) {
        if (ctx?.abortSignal) seen.push(ctx.abortSignal);
        return { output: 'ok', isError: false };
      },
    });

    const controller = new AbortController();
    await registry.execute('capture', {}, { abortSignal: controller.signal });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(controller.signal);
  });

  it('execute works without ctx (backward compat)', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'noop',
      description: '',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return { output: 'ok', isError: false };
      },
    });

    const result = await registry.execute('noop', {});
    expect(result.isError).toBe(false);
  });
});
