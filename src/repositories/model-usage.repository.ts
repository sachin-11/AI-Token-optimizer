import "server-only";

import { type ModelUsage, type AIProvider } from "@prisma/client";
import { BaseRepository } from "@/repositories/base.repository";

export type UpsertModelUsageInput = {
  userId: string;
  provider: AIProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  savedTokens?: number;
  costUsd?: number;
  savedCostUsd?: number;
  latencyMs?: number;
  success?: boolean;
  fromCache?: boolean;
};

export class ModelUsageRepository extends BaseRepository {
  constructor() { super("ModelUsage"); }

  async upsertDaily(input: UpsertModelUsageInput): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      await this.db.modelUsage.upsert({
        where: {
          userId_date_provider_model: {
            userId:   input.userId,
            date:     today,
            provider: input.provider,
            model:    input.model,
          },
        },
        update: {
          totalRequests:      { increment: 1 },
          successfulRequests: { increment: input.success !== false ? 1 : 0 },
          failedRequests:     { increment: input.success === false ? 1 : 0 },
          cachedRequests:     { increment: input.fromCache ? 1 : 0 },
          totalInputTokens:   { increment: input.inputTokens  ?? 0 },
          totalOutputTokens:  { increment: input.outputTokens ?? 0 },
          totalSavedTokens:   { increment: input.savedTokens  ?? 0 },
          totalCostUsd:       { increment: input.costUsd      ?? 0 },
          savedCostUsd:       { increment: input.savedCostUsd ?? 0 },
        },
        create: {
          userId:             input.userId,
          date:               today,
          provider:           input.provider,
          model:              input.model,
          totalRequests:      1,
          successfulRequests: input.success !== false ? 1 : 0,
          failedRequests:     input.success === false ? 1 : 0,
          cachedRequests:     input.fromCache ? 1 : 0,
          totalInputTokens:   input.inputTokens  ?? 0,
          totalOutputTokens:  input.outputTokens ?? 0,
          totalSavedTokens:   input.savedTokens  ?? 0,
          totalCostUsd:       input.costUsd      ?? 0,
          savedCostUsd:       input.savedCostUsd ?? 0,
          avgLatencyMs:       input.latencyMs    ?? 0,
        },
      });
    } catch (e) { this.handleError(e, "upsertDaily"); }
  }

  async getByUser(userId: string, days = 30): Promise<ModelUsage[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    try {
      return await this.db.modelUsage.findMany({
        where: { userId, date: { gte: since } },
        orderBy: [{ date: "desc" }, { model: "asc" }],
      });
    } catch (e) { this.handleError(e, "getByUser"); }
  }

  async getTopModels(userId: string, limit = 5): Promise<Array<{ model: string; provider: AIProvider; totalRequests: number; totalCostUsd: number }>> {
    try {
      return await this.db.$queryRaw`
        SELECT model, provider, SUM(total_requests)::int AS "totalRequests", SUM(total_cost_usd)::float AS "totalCostUsd"
        FROM model_usage WHERE user_id = ${userId}
        GROUP BY model, provider
        ORDER BY "totalRequests" DESC
        LIMIT ${limit}
      `;
    } catch (e) { this.handleError(e, "getTopModels"); }
  }
}

let instance: ModelUsageRepository | null = null;
export function getModelUsageRepository(): ModelUsageRepository {
  instance ??= new ModelUsageRepository();
  return instance;
}
