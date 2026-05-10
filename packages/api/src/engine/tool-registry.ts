import { createLogger } from '@clawix/shared';
import type { ToolDefinition } from '@clawix/shared';

import {
  toToolDefinition,
  type ParamSchema,
  type Tool,
  type ToolResult,
  type ToolExecuteContext,
} from './tool.js';

const logger = createLogger('engine:tool-registry');

/* ------------------------------------------------------------------ */
/*  Module-level helpers: validation                                   */
/* ------------------------------------------------------------------ */

/** Check whether a value matches the expected JSON Schema type. */
function checkType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/** Recursively validate an object against a ParamSchema. */
function validateObject(
  obj: Record<string, unknown>,
  schema: ParamSchema,
  path: string,
): readonly string[] {
  const errors: string[] = [];

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in obj) || obj[field] === undefined) {
        const fullPath = path ? `${path}.${field}` : field;
        errors.push(`Missing required parameter: ${fullPath}`);
      }
    }
  }

  // Validate each provided property
  if (schema.properties) {
    for (const [key, value] of Object.entries(obj)) {
      const propSchema = schema.properties[key];
      if (!propSchema) continue;

      const fullPath = path ? `${path}.${key}` : key;

      // Type check
      if (propSchema.type && !checkType(value, propSchema.type)) {
        errors.push(`Invalid type for ${fullPath}: expected ${propSchema.type}`);
        continue; // skip further checks if type is wrong
      }

      // Enum check
      if (propSchema.enum && !propSchema.enum.includes(value)) {
        errors.push(
          `Invalid value for ${fullPath}: must be one of [${propSchema.enum.join(', ')}]`,
        );
      }

      // Numeric range checks
      if (typeof value === 'number') {
        if (propSchema.minimum !== undefined && value < propSchema.minimum) {
          errors.push(`${fullPath} must be >= ${propSchema.minimum}`);
        }
        if (propSchema.maximum !== undefined && value > propSchema.maximum) {
          errors.push(`${fullPath} must be <= ${propSchema.maximum}`);
        }
      }

      // String length checks
      if (typeof value === 'string') {
        if (propSchema.minLength !== undefined && value.length < propSchema.minLength) {
          errors.push(`${fullPath} must have length >= ${propSchema.minLength}`);
        }
        if (propSchema.maxLength !== undefined && value.length > propSchema.maxLength) {
          errors.push(`${fullPath} must have length <= ${propSchema.maxLength}`);
        }
      }

      // Recurse into nested objects
      if (propSchema.type === 'object' && propSchema.properties && checkType(value, 'object')) {
        errors.push(...validateObject(value as Record<string, unknown>, propSchema, fullPath));
      }
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/*  Module-level helpers: casting                                      */
/* ------------------------------------------------------------------ */

/** Cast a single value to the expected JSON Schema type. */
function castValue(value: unknown, expectedType: string): unknown {
  if (typeof value !== 'string') return value;

  switch (expectedType) {
    case 'integer': {
      const parsed = parseInt(value, 10);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case 'number': {
      const parsed = parseFloat(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    case 'boolean': {
      const lower = value.toLowerCase();
      if (['true', '1', 'yes'].includes(lower)) return true;
      if (['false', '0', 'no'].includes(lower)) return false;
      return value;
    }
    default:
      return value;
  }
}

/** Recursively cast params to match schema types. Returns a new object. */
function castObject(
  params: Readonly<Record<string, unknown>>,
  schema: ParamSchema,
): Record<string, unknown> {
  if (!schema.properties) return { ...params };

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    const propSchema = schema.properties[key];
    if (!propSchema) {
      result[key] = value;
      continue;
    }

    if (
      propSchema.type === 'object' &&
      propSchema.properties &&
      typeof value === 'object' &&
      value !== null
    ) {
      result[key] = castObject(value as Record<string, unknown>, propSchema);
    } else if (propSchema.type) {
      result[key] = castValue(value, propSchema.type);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/** Strip keys not defined in the schema to prevent injection of unexpected params. */
function stripUnknownKeys(
  obj: Record<string, unknown>,
  schema: ParamSchema,
): Record<string, unknown> {
  if (!schema.properties) return obj;

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key in schema.properties) {
      result[key] = obj[key];
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  ToolRegistry                                                       */
/* ------------------------------------------------------------------ */

/**
 * Registry that manages tool lifecycle: registration, validation, and execution.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly maxOutputChars: number;

  constructor(maxOutputChars = 16_000) {
    this.maxOutputChars = maxOutputChars;
  }

  /** Register a tool. Overwrites any existing tool with the same name. */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      logger.warn({ tool: tool.name }, 'Overwriting existing tool registration');
    }
    logger.info({ tool: tool.name }, 'Registering tool');
    this.tools.set(tool.name, tool);
  }

  /** Check whether a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Retrieve a tool by name, or undefined if not found. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Return ToolDefinition[] for all registered tools (for LLM providers). */
  getDefinitions(): readonly ToolDefinition[] {
    return [...this.tools.values()].map(toToolDefinition);
  }

  /** Validate params against the tool's schema. Returns an array of error strings. */
  validateParams(toolName: string, params: Record<string, unknown>): readonly string[] {
    const tool = this.tools.get(toolName);
    if (!tool) return [`Tool not found: ${toolName}`];

    return validateObject(params, tool.parameters, '');
  }

  /** Cast params to match the tool's schema types. Returns a new object. */
  castParams(toolName: string, params: Record<string, unknown>): Record<string, unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) return params;

    return castObject(params, tool.parameters);
  }

  /**
   * Execute a tool: cast params, validate, run, and post-process output.
   * Returns a ToolResult with truncated output and error hints as needed.
   */
  async execute(
    toolName: string,
    params: Readonly<Record<string, unknown>>,
    ctx?: ToolExecuteContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { output: `Tool not found: ${toolName}`, isError: true };
    }

    // Cast first, then validate
    const castedParams = castObject(params, tool.parameters);
    const errors = validateObject(castedParams, tool.parameters, '');

    if (errors.length > 0) {
      const message = errors.join('\n');
      return {
        output: `${message}\n\n[Analyze the error above and try a different approach.]`,
        isError: true,
      };
    }

    try {
      const safeParams = stripUnknownKeys(castedParams, tool.parameters);
      const result = await tool.execute(safeParams, ctx);
      const output = this.truncate(result.output);

      if (result.isError) {
        return {
          output: `${output}\n\n[Analyze the error above and try a different approach.]`,
          isError: true,
        };
      }

      return { output, isError: false };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ tool: toolName, error: message }, 'Tool execution failed');
      return {
        output: `${message}\n\n[Analyze the error above and try a different approach.]`,
        isError: true,
      };
    }
  }

  /** Truncate output if it exceeds maxOutputChars. */
  private truncate(output: string): string {
    if (output.length <= this.maxOutputChars) return output;
    return `${output.slice(0, this.maxOutputChars)}\n... (truncated)`;
  }
}
