import { Injectable } from '@nestjs/common';
import { NotFoundError } from '@clawix/shared';

import type { PaginatedResponse, PaginationInput } from '@clawix/shared';
import type { User } from '../generated/prisma/client.js';
import type { UserRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPaginatedResponse, buildPaginationArgs, handlePrismaError } from './utils.js';

interface CreateUserData {
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly role?: UserRole;
  readonly policyId: string;
  readonly telegramId?: string;
  readonly whatsappJid?: string;
}

interface UpdateUserData {
  readonly name?: string;
  readonly role?: UserRole;
  readonly isActive?: boolean;
  readonly policyId?: string;
  readonly telegramId?: string | null;
  readonly whatsappJid?: string | null;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundError('User', id);
    }

    return user;
  }

  async findAll(pagination: PaginationInput): Promise<PaginatedResponse<User>> {
    const { skip, take } = buildPaginationArgs(pagination);

    const [total, data] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.findMany({ skip, take, orderBy: { createdAt: 'desc' } }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /**
   * Lightweight prefix search by name or email for in-app autocomplete
   * (e.g. group invite picker). Capped at `limit` rows; returns only
   * the minimum fields needed to render a suggestion.
   */
  async searchByNameOrEmail(
    query: string,
    limit: number,
  ): Promise<readonly { id: string; name: string | null; email: string }[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    return this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: trimmed, mode: 'insensitive' } },
          { name: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { email: 'asc' },
      take: limit,
    });
  }

  async findByTelegramId(telegramId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  async findByWhatsappJid(whatsappJid: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { whatsappJid } });
  }

  async findByPolicyId(
    policyId: string,
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<User>> {
    const { skip, take } = buildPaginationArgs(pagination);
    const where = { policyId };

    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
    ]);

    return buildPaginatedResponse(data, total, pagination);
  }

  async create(data: CreateUserData): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: data.email,
          name: data.name,
          passwordHash: data.passwordHash,
          policyId: data.policyId,
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.telegramId !== undefined ? { telegramId: data.telegramId } : {}),
          ...(data.whatsappJid !== undefined ? { whatsappJid: data.whatsappJid } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'User');
    }
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.role !== undefined ? { role: data.role } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.policyId !== undefined ? { policyId: data.policyId } : {}),
          ...(data.telegramId !== undefined ? { telegramId: data.telegramId } : {}),
          ...(data.whatsappJid !== undefined ? { whatsappJid: data.whatsappJid } : {}),
        },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'User');
    }
  }

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: { passwordHash },
      });
    } catch (error: unknown) {
      handlePrismaError(error, 'User');
    }
  }

  async delete(id: string): Promise<User> {
    try {
      return await this.prisma.user.delete({ where: { id } });
    } catch (error: unknown) {
      handlePrismaError(error, 'User');
    }
  }
}
