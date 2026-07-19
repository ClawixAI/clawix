import { Injectable } from '@nestjs/common';
import { NotFoundError, createLogger, getProviderSpec } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import { type AgentDefinition, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

const logger = createLogger('db:agent-definition');

interface CreateAgentDefinitionData {
  readonly name: string;
  readonly description?: string;
  readonly systemPrompt?: string;
  readonly role?: 'primary' | 'worker';
  readonly provider?: string;
  readonly model?: string;
  readonly apiBaseUrl?: string | null;
  readonly skillIds?: string[];
  readonly maxTokensPerRun?: number;
  readonly containerConfig?: Prisma.InputJsonValue;
  readonly streamingEnabled?: boolean;
  readonly isOfficial?: boolean;
  readonly createdById?: string | null;
}

type UpdateAgentDefinitionData = Partial<CreateAgentDefinitionData> & {
  readonly isActive?: boolean;
  readonly toolConfig?: Record<string, unknown>;
};

@Injectable()
export class AgentDefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find the first active agent definition matching the given name.
   * Returns null if not found (does NOT throw NotFoundError).
   */
  async findByName(name: string): Promise<AgentDefinition | null> {
    return this.prisma.agentDefinition.findFirst({
      where: { name, isActive: true },
    });
  }

  /**
   * Return all active agent definitions with role = 'worker'.
   */
  async findActiveWorkers(): Promise<AgentDefinition[]> {
    return this.prisma.agentDefinition.findMany({
      where: { role: 'worker', isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Find or create the built-in "default-worker" agent definition used
   * for anonymous sub-agent spawns.
   *
   * Resolves provider/model from the active default `ProviderConfig` and the
   * provider registry. If an existing row is found with a provider that is no
   * longer configured, it is healed in place (provider/model overwritten with
   * the current default).
   */
  async findOrCreateDefaultWorker(): Promise<AgentDefinition> {
    const existing = await this.prisma.agentDefinition.findFirst({
      where: { name: 'default-worker', role: 'worker' },
    });

    // Fast path: existing row whose provider is still configured.
    if (existing) {
      const matching = await this.prisma.providerConfig.findFirst({
        where: { provider: existing.provider, isEnabled: true },
      });
      if (matching) {
        return existing;
      }
      logger.warn(
        { defaultWorkerId: existing.id, staleProvider: existing.provider },
        'default-worker provider is not configured; healing to current default',
      );
    }

    const { provider, model } = await this.resolveDefaultWorkerProviderModel();

    if (existing) {
      return this.prisma.agentDefinition.update({
        where: { id: existing.id },
        data: { provider, model },
      });
    }

    return this.prisma.agentDefinition.create({
      data: this.buildDefaultWorkerData('default-worker', provider, model),
    });
  }

  /**
   * Find or create a default worker whose provider is permitted by the spawning
   * user's policy (`Policy.allowedProviders`).
   *
   * When the org default provider is allowed (or no restriction is supplied),
   * this is exactly {@link findOrCreateDefaultWorker}. When the org default is
   * out-of-policy, the first allowed provider that is both configured (enabled
   * `ProviderConfig`) and resolvable in the provider registry is substituted,
   * backed by a per-provider `default-worker-<provider>` row — so anonymous
   * sub-agent spawns keep working without forcing the org default into every
   * policy, and without ever binding an out-of-policy provider.
   */
  async findOrCreateDefaultWorkerForPolicy(allowedProviders?: string[]): Promise<AgentDefinition> {
    const defaultProviderConfig = await this.prisma.providerConfig.findFirst({
      where: { isDefault: true, isEnabled: true },
    });
    if (!defaultProviderConfig) {
      throw new Error(
        'No default provider configured. Set isDefault=true on a ProviderConfig row, ' +
          'or configure DEFAULT_PROVIDER and re-run bootstrap.',
      );
    }
    const orgDefault = defaultProviderConfig.provider;

    // No restriction context, or the org default is permitted → standard path.
    if (
      !allowedProviders ||
      allowedProviders.length === 0 ||
      allowedProviders.includes(orgDefault)
    ) {
      return this.findOrCreateDefaultWorker();
    }

    // Restricted: the org default is out-of-policy. Substitute the first allowed
    // provider that is both configured and resolvable in the registry.
    for (const provider of allowedProviders) {
      const config = await this.prisma.providerConfig.findFirst({
        where: { provider, isEnabled: true },
      });
      if (!config) {
        continue;
      }
      const model = this.tryResolveModelForProvider(provider);
      if (!model) {
        continue;
      }
      return this.findOrCreateNamedDefaultWorker(`default-worker-${provider}`, provider, model);
    }

    throw new Error(
      `None of your policy's allowed providers (${allowedProviders.join(', ')}) is configured ` +
        'for anonymous sub-agent spawns. Ask an admin to enable one, or spawn a named worker agent.',
    );
  }

  /** Find or create a per-provider default worker row by exact name. */
  private async findOrCreateNamedDefaultWorker(
    name: string,
    provider: string,
    model: string,
  ): Promise<AgentDefinition> {
    const existing = await this.prisma.agentDefinition.findFirst({
      where: { name, role: 'worker' },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.agentDefinition.create({
      data: this.buildDefaultWorkerData(name, provider, model),
    });
  }

  /** Shared create payload for anonymous default-worker definitions. */
  private buildDefaultWorkerData(
    name: string,
    provider: string,
    model: string,
  ): Prisma.AgentDefinitionCreateInput {
    return {
      name,
      description: 'Default worker agent for anonymous sub-agent tasks',
      systemPrompt: 'Complete the assigned task thoroughly and report the result.',
      role: 'worker',
      provider,
      model,
      maxTokensPerRun: 50000,
      containerConfig: {
        image: process.env['AGENT_CONTAINER_IMAGE'] ?? 'clawix-agent:latest',
        cpuLimit: '0.5',
        memoryLimit: '256m',
        timeoutSeconds: 300,
        readOnlyRootfs: false,
        allowedMounts: [],
      },
    };
  }

  /** Resolve a provider's default model from the registry; null if unavailable. */
  private tryResolveModelForProvider(provider: string): string | null {
    try {
      return getProviderSpec(provider).defaultModel || null;
    } catch {
      return null;
    }
  }

  private async resolveDefaultWorkerProviderModel(): Promise<{
    provider: string;
    model: string;
  }> {
    const defaultProviderConfig = await this.prisma.providerConfig.findFirst({
      where: { isDefault: true, isEnabled: true },
    });
    if (!defaultProviderConfig) {
      throw new Error(
        'No default provider configured. Set isDefault=true on a ProviderConfig row, ' +
          'or configure DEFAULT_PROVIDER and re-run bootstrap.',
      );
    }

    const provider = defaultProviderConfig.provider;
    let model: string;
    try {
      model = getProviderSpec(provider).defaultModel;
    } catch {
      throw new Error(
        `Default provider "${provider}" is not in the provider registry; ` +
          'cannot resolve a default sub-agent model. Create a worker AgentDefinition explicitly.',
      );
    }
    if (!model) {
      throw new Error(
        `Default provider "${provider}" has no defaultModel; ` +
          'cannot resolve a default sub-agent model. Create a worker AgentDefinition explicitly.',
      );
    }
    return { provider, model };
  }

  async findById(id: string): Promise<AgentDefinition> {
    const agent = await this.prisma.agentDefinition.findUnique({ where: { id } });

    if (!agent) {
      throw new NotFoundError('AgentDefinition', id);
    }

    return agent;
  }

  async findByRole(
    role: 'primary' | 'worker',
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<AgentDefinition>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { role };

    const [total, data] = await Promise.all([
      this.prisma.agentDefinition.count({ where }),
      this.prisma.agentDefinition.findMany({
        skip,
        take,
        where,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findAll(
    pagination: PaginationInput,
    options?: { includeCreatedBy?: boolean },
  ): Promise<PaginatedResponse<AgentDefinition>> {
    const { skip, take } = buildPaginationArgs(pagination);

    const [total, data] = await Promise.all([
      this.prisma.agentDefinition.count(),
      this.prisma.agentDefinition.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        ...(options?.includeCreatedBy
          ? { include: { createdBy: { select: { id: true, name: true, email: true } } } }
          : {}),
      }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findActive(pagination: PaginationInput): Promise<PaginatedResponse<AgentDefinition>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { isActive: true };

    const [total, data] = await Promise.all([
      this.prisma.agentDefinition.count({ where }),
      this.prisma.agentDefinition.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  /**
   * Count the agent definitions created by a given user. Used to enforce the
   * per-policy `maxAgents` limit at creation time.
   */
  async countByCreator(userId: string): Promise<number> {
    return this.prisma.agentDefinition.count({ where: { createdById: userId } });
  }

  async create(data: CreateAgentDefinitionData): Promise<AgentDefinition> {
    try {
      return await this.prisma.agentDefinition.create({
        data: {
          name: data.name,
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.provider !== undefined ? { provider: data.provider } : {}),
          ...(data.model !== undefined ? { model: data.model } : {}),
          ...(data.apiBaseUrl !== undefined ? { apiBaseUrl: data.apiBaseUrl } : {}),
          ...(data.skillIds !== undefined ? { skillIds: data.skillIds } : {}),
          ...(data.maxTokensPerRun !== undefined ? { maxTokensPerRun: data.maxTokensPerRun } : {}),
          ...(data.containerConfig !== undefined ? { containerConfig: data.containerConfig } : {}),
          ...(data.streamingEnabled !== undefined
            ? { streamingEnabled: data.streamingEnabled }
            : {}),
          ...(data.isOfficial !== undefined ? { isOfficial: data.isOfficial } : {}),
          ...(data.createdById !== undefined ? { createdById: data.createdById } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentDefinition');
    }
  }

  async update(id: string, data: UpdateAgentDefinitionData): Promise<AgentDefinition> {
    try {
      return await this.prisma.agentDefinition.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.systemPrompt !== undefined ? { systemPrompt: data.systemPrompt } : {}),
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.provider !== undefined ? { provider: data.provider } : {}),
          ...(data.model !== undefined ? { model: data.model } : {}),
          ...(data.apiBaseUrl !== undefined ? { apiBaseUrl: data.apiBaseUrl } : {}),
          ...(data.skillIds !== undefined ? { skillIds: data.skillIds } : {}),
          ...(data.maxTokensPerRun !== undefined ? { maxTokensPerRun: data.maxTokensPerRun } : {}),
          ...(data.containerConfig !== undefined ? { containerConfig: data.containerConfig } : {}),
          ...(data.streamingEnabled !== undefined
            ? { streamingEnabled: data.streamingEnabled }
            : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.isOfficial !== undefined ? { isOfficial: data.isOfficial } : {}),
          ...(data.toolConfig !== undefined
            ? { toolConfig: data.toolConfig as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentDefinition');
    }
  }

  async delete(id: string): Promise<AgentDefinition> {
    try {
      return await this.prisma.agentDefinition.delete({ where: { id } });
    } catch (error: unknown) {
      handlePrismaError(error, 'AgentDefinition');
    }
  }
}
