import { Injectable } from '@nestjs/common';

import { TokenUsageRepository } from '../db/token-usage.repository.js';
import { PolicyRepository } from '../db/policy.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TokensService {
  constructor(
    private readonly tokenUsageRepo: TokenUsageRepository,
    private readonly policyRepo: PolicyRepository,
    private readonly prisma: PrismaService,
  ) {}

  private getMonthRange() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { startOfMonth, endOfMonth };
  }

  async getSummary(userId: string, policyId: string) {
    const { startOfMonth, endOfMonth } = this.getMonthRange();
    const policy = await this.policyRepo.findById(policyId);
    const usage = await this.tokenUsageRepo.sumByUserId(userId, startOfMonth, endOfMonth);

    const budgetTokens = policy.maxTokenBudget;
    const budgetUsd = budgetTokens !== null ? budgetTokens / 100 : null;

    return {
      budget: {
        maxTokenBudget: budgetTokens,
        budgetUsd,
        unlimited: budgetTokens === null,
      },
      usage: {
        totalTokens: usage.totalTokens,
        totalInputTokens: usage.totalInputTokens,
        totalOutputTokens: usage.totalOutputTokens,
        totalEstimatedCostUsd: usage.totalEstimatedCostUsd,
      },
      period: {
        startDate: startOfMonth.toISOString(),
        endDate: endOfMonth.toISOString(),
      },
    };
  }

  async getSummaryByUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { policyId: true },
    });
    if (!user) return null;
    return this.getSummary(userId, user.policyId);
  }

  async getPerUserBreakdown(userRole: string, userId: string) {
    const { startOfMonth, endOfMonth } = this.getMonthRange();

    let userUsages: {
      userId: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      totalEstimatedCostUsd: number;
    }[];

    if (userRole === 'admin') {
      userUsages = await this.tokenUsageRepo.sumAllUsers(startOfMonth, endOfMonth);
    } else {
      const single = await this.tokenUsageRepo.sumByUserId(userId, startOfMonth, endOfMonth);
      userUsages = [{ userId, ...single }];
    }

    const userIds = userUsages.map((u) => u.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return userUsages.map((u) => ({
      userId: u.userId,
      userName: userMap.get(u.userId)?.name ?? 'Unknown',
      userEmail: userMap.get(u.userId)?.email ?? '',
      totalInputTokens: u.totalInputTokens,
      totalOutputTokens: u.totalOutputTokens,
      totalTokens: u.totalTokens,
      totalEstimatedCostUsd: u.totalEstimatedCostUsd,
    }));
  }

  async getUserAgentBreakdown(userId: string) {
    const { startOfMonth, endOfMonth } = this.getMonthRange();
    const agentUsages = await this.tokenUsageRepo.sumByUserGroupedByAgent(
      userId,
      startOfMonth,
      endOfMonth,
    );

    const agentIds = agentUsages.map((a) => a.agentDefinitionId);
    const agents = await this.prisma.agentDefinition.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true },
    });
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    return agentUsages.map((a) => ({
      agentDefinitionId: a.agentDefinitionId,
      agentName: agentMap.get(a.agentDefinitionId)?.name ?? 'Unknown',
      totalInputTokens: a.totalInputTokens,
      totalOutputTokens: a.totalOutputTokens,
      totalTokens: a.totalTokens,
      totalEstimatedCostUsd: a.totalEstimatedCostUsd,
    }));
  }

  async getUsageOverTime(period: 'daily' | 'weekly' | 'monthly', userId?: string) {
    const now = new Date();
    let startDate: Date;
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (period === 'daily') {
      // Last 30 days
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
      return this.tokenUsageRepo.dailyUsage(startDate, endDate, userId);
    }

    if (period === 'weekly') {
      // Last 12 weeks — fetch daily then aggregate by ISO week
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 83); // 12 weeks
      startDate.setHours(0, 0, 0, 0);
      const daily = await this.tokenUsageRepo.dailyUsage(startDate, endDate, userId);

      const weeks = new Map<
        string,
        { date: string; totalTokens: number; totalEstimatedCostUsd: number }
      >();
      for (const day of daily) {
        const d = new Date(day.date);
        // Week start (Monday)
        const dayOfWeek = d.getDay();
        const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        const weekStart = new Date(d.getFullYear(), d.getMonth(), diff);
        const key = weekStart.toISOString().slice(0, 10);
        const existing = weeks.get(key);
        if (existing) {
          existing.totalTokens += day.totalTokens;
          existing.totalEstimatedCostUsd += day.totalEstimatedCostUsd;
        } else {
          weeks.set(key, {
            date: key,
            totalTokens: day.totalTokens,
            totalEstimatedCostUsd: day.totalEstimatedCostUsd,
          });
        }
      }
      return Array.from(weeks.values()).sort((a, b) => a.date.localeCompare(b.date));
    }

    // Monthly — last 12 months, aggregate by YYYY-MM
    startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const daily = await this.tokenUsageRepo.dailyUsage(startDate, endDate, userId);

    const months = new Map<
      string,
      { date: string; totalTokens: number; totalEstimatedCostUsd: number }
    >();
    for (const day of daily) {
      const key = day.date.slice(0, 7); // YYYY-MM
      const existing = months.get(key);
      if (existing) {
        existing.totalTokens += day.totalTokens;
        existing.totalEstimatedCostUsd += day.totalEstimatedCostUsd;
      } else {
        months.set(key, {
          date: key,
          totalTokens: day.totalTokens,
          totalEstimatedCostUsd: day.totalEstimatedCostUsd,
        });
      }
    }
    return Array.from(months.values()).sort((a, b) => a.date.localeCompare(b.date));
  }
}
