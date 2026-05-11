/**
 * Token Analytics Service
 *
 * Aggregates token usage data for the analytics dashboard.
 * Reads from the database (UsageStat model) and computes derived metrics.
 *
 * Separation from token-counter: counting is a hot path (every request),
 * analytics is a cold path (dashboard queries). Different performance profiles.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { createChildLogger } from "@/lib/logger";
import { modelRegistry } from "@/services/ai/model-registry";
import { AIProviderName, type AIModel } from "@/types/ai";

const log = createChildLogger({ module: "TokenAnalyticsService" });

// ─── Analytics Types ──────────────────────────────────────────────────────────

export interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  cacheHitRate: number;
  avgTokensPerRequest: number;
  avgCostPerRequest: number;
}

export interface DailyUsagePoint {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  requests: number;
  cacheHits: number;
}

export interface ModelUsageBreakdown {
  model: AIModel;
  provider: AIProviderName;
  requests: number;
  totalTokens: number;
  costUsd: number;
  percentOfTotal: number;
}

// ─── Analytics Service ────────────────────────────────────────────────────────

export class TokenAnalyticsService {
  /**
   * Get usage summary for a user over a date range.
   */
  async getUserSummary(
    userId: string,
    options?: { startDate?: Date; endDate?: Date },
  ): Promise<UsageSummary> {
    const where = {
      userId,
      ...(options?.startDate || options?.endDate
        ? {
            date: {
              ...(options.startDate && { gte: options.startDate }),
              ...(options.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const stats = await prisma.usageStat.aggregate({
      where,
      _sum: {
        totalRequests: true,
        totalInputTokens: true,
        totalOutputTokens: true,
        totalCostUsd: true,
        cacheHits: true,
      },
    });

    const totalRequests = stats._sum.totalRequests ?? 0;
    const totalInputTokens = stats._sum.totalInputTokens ?? 0;
    const totalOutputTokens = stats._sum.totalOutputTokens ?? 0;
    const totalCostUsd = stats._sum.totalCostUsd ?? 0;
    const cacheHits = stats._sum.cacheHits ?? 0;

    return {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      cacheHitRate:
        totalRequests > 0
          ? Number(((cacheHits / totalRequests) * 100).toFixed(1))
          : 0,
      avgTokensPerRequest:
        totalRequests > 0
          ? Math.round((totalInputTokens + totalOutputTokens) / totalRequests)
          : 0,
      avgCostPerRequest:
        totalRequests > 0
          ? Number((totalCostUsd / totalRequests).toFixed(6))
          : 0,
    };
  }

  /**
   * Get daily usage time series for charting.
   */
  async getDailyUsage(
    userId: string,
    days = 30,
  ): Promise<DailyUsagePoint[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await prisma.usageStat.findMany({
      where: { userId, date: { gte: startDate } },
      orderBy: { date: "asc" },
    });

    return stats.map((s) => ({
      date: s.date.toISOString().split("T")[0] ?? "",
      inputTokens: s.totalInputTokens,
      outputTokens: s.totalOutputTokens,
      totalTokens: s.totalInputTokens + s.totalOutputTokens,
      costUsd: Number(s.totalCostUsd.toFixed(6)),
      requests: s.totalRequests,
      cacheHits: s.cacheHits,
    }));
  }

  /**
   * Get token usage breakdown by model.
   */
  async getModelBreakdown(
    userId: string,
    options?: { startDate?: Date; endDate?: Date },
  ): Promise<ModelUsageBreakdown[]> {
    const where = {
      userId,
      ...(options?.startDate || options?.endDate
        ? {
            date: {
              ...(options.startDate && { gte: options.startDate }),
              ...(options.endDate && { lte: options.endDate }),
            },
          }
        : {}),
    };

    const stats = await prisma.usageStat.groupBy({
      by: ["model", "provider"],
      where,
      _sum: {
        totalRequests: true,
        totalInputTokens: true,
        totalOutputTokens: true,
        totalCostUsd: true,
      },
    });

    const totalCost = stats.reduce((sum, s) => sum + (s._sum.totalCostUsd ?? 0), 0);

    return stats
      .map((s) => {
        const totalTokens =
          (s._sum.totalInputTokens ?? 0) + (s._sum.totalOutputTokens ?? 0);
        const costUsd = s._sum.totalCostUsd ?? 0;

        return {
          model: s.model as AIModel,
          provider: s.provider as AIProviderName,
          requests: s._sum.totalRequests ?? 0,
          totalTokens,
          costUsd: Number(costUsd.toFixed(6)),
          percentOfTotal:
            totalCost > 0
              ? Number(((costUsd / totalCost) * 100).toFixed(1))
              : 0,
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd);
  }

  /**
   * Record token usage after a completion.
   * Upserts into UsageStat — one row per (user, date, provider, model).
   */
  async recordUsage(params: {
    userId: string;
    provider: AIProviderName;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    fromCache: boolean;
  }): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      await prisma.usageStat.upsert({
        where: {
          userId_date_provider_model: {
            userId: params.userId,
            date: today,
            provider: params.provider,
            model: params.model,
          },
        },
        update: {
          totalRequests: { increment: 1 },
          totalInputTokens: { increment: params.inputTokens },
          totalOutputTokens: { increment: params.outputTokens },
          totalCostUsd: { increment: params.costUsd },
          cacheHits: { increment: params.fromCache ? 1 : 0 },
        },
        create: {
          userId: params.userId,
          date: today,
          provider: params.provider,
          model: params.model,
          totalRequests: 1,
          totalInputTokens: params.inputTokens,
          totalOutputTokens: params.outputTokens,
          totalCostUsd: params.costUsd,
          cacheHits: params.fromCache ? 1 : 0,
        },
      });
    } catch (error) {
      // Analytics recording failure should not break the main flow
      log.error({ err: error, userId: params.userId }, "Failed to record usage stats");
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: TokenAnalyticsService | null = null;

export function getTokenAnalytics(): TokenAnalyticsService {
  instance ??= new TokenAnalyticsService();
  return instance;
}
