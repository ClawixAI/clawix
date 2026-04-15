import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import { type Channel, type Policy, Prisma, type User } from '../generated/prisma/client.js';
import type {
  ChannelType as PrismaChannelType,
  GroupMemberRole,
  UserRole,
} from '../generated/prisma/enums.js';
import { ChannelRepository } from '../db/channel.repository.js';
import { ChannelManagerService } from '../channels/channel-manager.service.js';
import { encryptChannelConfig, maskChannelConfig } from '../channels/channel-config-crypto.js';
import { GroupRepository } from '../db/group.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { UserRepository } from '../db/user.repository.js';
import { BCRYPT_SALT_ROUNDS_DEFAULT } from '../auth/auth.constants.js';

type SafeUser = Omit<User, 'passwordHash'>;

interface CreateUserInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly role?: UserRole;
  readonly policyId: string;
}

interface UpdateUserInput {
  readonly name?: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
  readonly policyId?: string;
}

@Injectable()
export class AdminService {
  private readonly saltRounds: number;

  constructor(
    private readonly userRepo: UserRepository,
    private readonly channelRepo: ChannelRepository,
    private readonly channelManager: ChannelManagerService,
    private readonly groupRepo: GroupRepository,
    private readonly policyRepo: PolicyRepository,
    private readonly config: ConfigService,
  ) {
    this.saltRounds = Number(
      this.config.get<string>('BCRYPT_SALT_ROUNDS') ?? BCRYPT_SALT_ROUNDS_DEFAULT,
    );
  }

  private stripPassword(user: User): SafeUser {
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async listUsers(pagination: PaginationInput): Promise<PaginatedResponse<SafeUser>> {
    const result = await this.userRepo.findAll(pagination);
    return { ...result, data: result.data.map((u) => this.stripPassword(u)) };
  }

  async getUser(id: string): Promise<SafeUser> {
    return this.stripPassword(await this.userRepo.findById(id));
  }

  async createUser(input: CreateUserInput): Promise<SafeUser> {
    const passwordHash = await hash(input.password, this.saltRounds);
    return this.stripPassword(await this.userRepo.create({
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      policyId: input.policyId,
    }));
  }

  async updateUser(id: string, input: UpdateUserInput): Promise<SafeUser> {
    return this.stripPassword(await this.userRepo.update(id, input));
  }

  async deleteUser(id: string): Promise<SafeUser> {
    return this.stripPassword(await this.userRepo.delete(id));
  }

  // ---- Channel management ---- //

  private maskChannelSecrets(channel: Channel): Channel {
    return {
      ...channel,
      config: maskChannelConfig(channel.type, (channel.config ?? {}) as Record<string, unknown>) as Prisma.JsonValue,
    };
  }

  getConnectedChannelIds(): readonly string[] {
    return this.channelManager.getConnectedChannelIds();
  }

  async listChannels(pagination: PaginationInput): Promise<PaginatedResponse<Channel>> {
    const result = await this.channelRepo.findAll(pagination);
    return { ...result, data: result.data.map((ch) => this.maskChannelSecrets(ch)) };
  }

  async getChannel(id: string): Promise<Channel> {
    return this.maskChannelSecrets(await this.channelRepo.findById(id));
  }

  async createChannel(input: {
    readonly type: string;
    readonly name: string;
    readonly config?: Record<string, unknown>;
  }): Promise<Channel> {
    const encryptedConfig = encryptChannelConfig(input.type, input.config ?? {});
    const channel = await this.channelRepo.create({
      type: input.type as PrismaChannelType,
      name: input.name,
      config: encryptedConfig as Prisma.InputJsonValue,
    });
    await this.channelManager.reloadAll();
    return this.maskChannelSecrets(channel);
  }

  async updateChannel(
    id: string,
    input: {
      readonly name?: string;
      readonly config?: Record<string, unknown>;
      readonly isActive?: boolean;
    },
  ): Promise<Channel> {
    let encryptedConfig: Prisma.InputJsonValue | undefined;
    if (input.config) {
      const existing = await this.channelRepo.findById(id);
      encryptedConfig = encryptChannelConfig(
        existing.type,
        input.config,
      ) as Prisma.InputJsonValue;
    }
    const channel = await this.channelRepo.update(id, {
      name: input.name,
      config: encryptedConfig,
      isActive: input.isActive,
    });
    await this.channelManager.reloadAll();
    return this.maskChannelSecrets(channel);
  }

  async deleteChannel(id: string): Promise<Channel> {
    const channel = await this.channelRepo.delete(id);
    await this.channelManager.reloadAll();
    return channel;
  }

  // ---- Policy management ---- //

  async listPolicies(pagination: PaginationInput): Promise<PaginatedResponse<Policy>> {
    return this.policyRepo.findAll(pagination);
  }

  async getPolicy(id: string): Promise<Policy> {
    return this.policyRepo.findById(id);
  }

  async createPolicy(input: {
    readonly name: string;
    readonly description?: string | null;
    readonly maxTokenBudget?: number | null;
    readonly maxAgents?: number;
    readonly maxSkills?: number;
    readonly maxMemoryItems?: number;
    readonly maxGroupsOwned?: number;
    readonly allowedProviders?: string[];
    readonly features?: Record<string, unknown>;
  }): Promise<Policy> {
    return this.policyRepo.create({
      ...input,
      features: input.features as Prisma.InputJsonValue | undefined,
    });
  }

  async updatePolicy(
    id: string,
    input: {
      readonly name?: string;
      readonly description?: string | null;
      readonly maxTokenBudget?: number | null;
      readonly maxAgents?: number;
      readonly maxSkills?: number;
      readonly maxMemoryItems?: number;
      readonly maxGroupsOwned?: number;
      readonly allowedProviders?: string[];
      readonly cronEnabled?: boolean;
      readonly maxScheduledTasks?: number;
      readonly minCronIntervalSecs?: number;
      readonly maxTokensPerCronRun?: number | null;
      readonly features?: Record<string, unknown>;
      readonly isActive?: boolean;
    },
  ): Promise<Policy> {
    return this.policyRepo.update(id, {
      ...input,
      features: input.features as Prisma.InputJsonValue | undefined,
    });
  }

  async deletePolicy(id: string): Promise<Policy> {
    return this.policyRepo.delete(id);
  }

  // ---- Group management ---- //

  async listGroups(pagination: PaginationInput) {
    return this.groupRepo.findAll(pagination);
  }

  async getGroup(id: string) {
    return this.groupRepo.findById(id);
  }

  async createGroup(
    input: { readonly name: string; readonly description?: string },
    createdById: string,
  ) {
    return this.groupRepo.create({ ...input, createdById });
  }

  async updateGroup(
    id: string,
    input: { readonly name?: string; readonly description?: string | null },
  ) {
    return this.groupRepo.update(id, input);
  }

  async deleteGroup(id: string) {
    return this.groupRepo.delete(id);
  }

  async listGroupMembers(groupId: string) {
    return this.groupRepo.listMembers(groupId);
  }

  async addGroupMember(
    groupId: string,
    input: { readonly userId: string; readonly role?: GroupMemberRole },
  ) {
    return this.groupRepo.addMember(groupId, input.userId, input.role ?? 'MEMBER');
  }

  async removeGroupMember(groupId: string, userId: string) {
    return this.groupRepo.removeMember(groupId, userId);
  }

  async updateGroupMemberRole(
    groupId: string,
    userId: string,
    input: { readonly role: GroupMemberRole },
  ) {
    return this.groupRepo.updateMemberRole(groupId, userId, input.role);
  }
}
