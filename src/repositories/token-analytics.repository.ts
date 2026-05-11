import "server-only";

import { type TokenAnalytic, type Prisma, type AIProvider, type PromptType, type OptimizationMode } from "@prisma/client";
import { BaseRepository, type PaginationParams, type PaginatedResult } from "@/repositories/base.repository";

export type CreateTokenAnalyticInput = {
  userId: string;
  requestId?: string;
  provider: AIProvider;
  model: string;
  promptType: PromptType;
  mode: OptimizationMode;
  originalTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  compressionRatio: number;
  originalCostUsd: number;
  optimizedCostUsd: number;
  savedCostUsd: number;
  semanticScore?: number;
  qualityScore?: number;
};

export class TokenAnalyticsRepository extends BaseRepository {
  constructor() { super("TokenAnalytic"); }

  async create(input: CreateTokenAnalyticInput): Promise<TokenAnalytic> {
    try {
      return await this.db.tokenAnalytic.create({ data: input });
    } catch (e) { this.handleError(e, "create"); }
  }

  async listByUser(
    userId: string,
    params: PaginationParams & { since?: Date; promptType?: PromptType },
  ): Promise<PaginatedResult<TokenAnalytic>> {
    const { skip, take } = this.buildPagination(params);
    const where: Prisma.TokenAnalyticWhereInput = {
      userId,
      ...(params.since      && { createdAt:  { gte: params.since } }),
      ...(params.promptType && { promptType: params.promptType }),
    };
    try {
      const [data, total] = await this.db.$transaction([
        this.db.tokenAnalytic.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
        this.db.tokenAnalytic.count({ where }),
      ]);
      return this.buildPaginatedResult(data, total, params);
    } catch (e) { this.handleError(e, "listByUser"); }
  }

  async getAggregate(userId: string, since?: Date) {
    try {
      return await this.db.tokenAnalytic.aggregate({
        where: { userId, ...(since && { createdAt: { gte: since } }) },
        _count: { id: true },
        _sum:   { savedTokens: true, savedCostUsd: true, originalTokens: true, optimizedTokens: true },
        _avg:   { compressionRatio: true, semanticScore: true, qualityScore: true },
      });
    } catch (e) { this.handleError(e, "getAggregate"); }
  }

  async getDailyTimeSeries(userId: string, days = 30) {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      return await this.db.$queryRaw<
        Array<{ date: string; total_saved: number; avg_ratio: number; requests: number }>
      >`
        SELECT
          DATE(created_at)::text AS date,
          SUM(saved_tokens)::int AS total_saved,
          AVG(compression_ratio)::float AS avg_ratio,
          COUNT(*)::int AS requests
        FROM token_analytics
        WHERE user_id = ${userId} AND created_at >= ${since}
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `;
    } catch (e) { this.handleError(e, "getDailyTimeSeries"); }
  }
}

let instance: TokenAnalyticsRepository | null = null;
export function getTokenAnalyticsRepository(): TokenAnalyticsRepository {
  instance ??= new TokenAnalyticsRepository();
  return instance;
}
