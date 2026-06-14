import { z } from 'zod';
import { mcpBindingsSchema } from './mcp.schema.js';

export const agentRoleEnum = z.enum(['primary', 'worker']);

const containerConfigSchema = z.object({
  image: z.string().min(1),
  cpuLimit: z.string().default('1'),
  memoryLimit: z.string().default('512m'),
  timeoutSeconds: z.number().int().positive().default(300),
  readOnlyRootfs: z.boolean().default(true),
  allowedMounts: z.array(z.string()).default([]),
  idleTimeoutSeconds: z.number().int().min(0).default(300),
});

export const createAgentDefinitionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).default(''),
  systemPrompt: z.string().min(1).max(50000),
  role: agentRoleEnum.default('primary'),
  provider: z.string().min(1),
  model: z.string().min(1),
  apiBaseUrl: z.string().url().nullable().optional(),
  skillIds: z.array(z.string().cuid()).default([]),
  maxTokensPerRun: z.number().int().positive().default(100000),
  containerConfig: containerConfigSchema.default({
    image: 'node:20-slim',
    cpuLimit: '1',
    memoryLimit: '512m',
    timeoutSeconds: 300,
    readOnlyRootfs: true,
    allowedMounts: [],
    idleTimeoutSeconds: 300,
  }),
  /**
   * When true, intermediate model prose is streamed to the channel as
   * separate messages. Off by default for backward compatibility.
   */
  streamingEnabled: z.boolean().default(false),
  /**
   * When true, the agent is a Public (official) agent visible to all users.
   * The server enforces that only admins may set this to true; for all other
   * callers the value is forced to false in the service layer.
   */
  isOfficial: z.boolean().default(false),
});

/**
 * Validates the `toolConfig` JSON blob on agent update.
 * The `mcp` key is validated against `mcpBindingsSchema` when present (TOFU
 * enforcement: wildcards rejected, explicit arrays only).  Any other keys
 * (e.g. browser config) are passed through unchanged via `.passthrough()`.
 */
const toolConfigSchema = z.object({ mcp: mcpBindingsSchema.optional() }).passthrough().optional();

export const updateAgentDefinitionSchema = createAgentDefinitionSchema
  .partial()
  .extend({ isActive: z.boolean().optional(), toolConfig: toolConfigSchema });

export type CreateAgentDefinitionInput = z.infer<typeof createAgentDefinitionSchema>;
export type UpdateAgentDefinitionInput = z.infer<typeof updateAgentDefinitionSchema>;
