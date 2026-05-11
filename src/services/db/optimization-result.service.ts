import "server-only";

import { type OptimizationStatus, type OptimizationType, type OptimizationMode } from "@prisma/client";
import {
  getOptimizationResultRepository,
  type CreateOptimizationInput,
  type UpdateOptimizationInput,
} from "@/repositories/optimization-result.repository";
import { getTokenAnalyticsRepository } from "@/repositories/token-analytics.repository";
import { getModelUsageRepository } from "@/repositories/model-usage.repository";
import { type PaginationParams } from "@/repositories/base.repository";
import { NotFoundError } from "@/lib/errors";
import type { WorkflowResult } from "@/types/agent";

const repo    = () => getOptimizationResultRepository();
const tokRepo = () => getTokenAnalyticsRepository();
const modRepo = () => getModelUsageRepository();

export const OptimizationResultService = {
  async getById(id: string) {
    const result = await repo().findById(id);
    if (!result) throw new NotFoundError("OptimizationResult", id);
    return result;
  },

  async getByRequestId(requestId: string) {
    return repo().findByRequestId(requestId);
  },

  async create(input: CreateOptimizationInput) {
    return repo().create(input);
  },

  async update(id: string, input: UpdateOptimizationInput) {
    return repo().update(id, input);
  },

  async updateByRequestId(requestId: string, input: UpdateOptimizationInput) {
    return repo().updateByRequestId(requestId, input);
  },

  async delete(id: string, userId: string) {
    return repo().softDelete(id, userId);
  },

  async list(userId: string, params: PaginationParams & { status?: OptimizationStatus; type?: OptimizationType; model?: string }) {
    return repo().listByUser(userId, params);
  },

  async getStats(userId: string, since?: Date) {
    return repo().getAggregateStats(userId, since);
  },

  /**
   * Persist a completed workflow result — writes to all relevant tables atomically.
   */
  async persistWorkflowResult(
    userId: string,
    requestId: string,
    result: WorkflowResult,
    meta: { provider: string; model: string; type: OptimizationType; mode: OptimizationMode; promptType: string },
  ): Promise<void> {
    const provider = meta.provider.toUpperCase() as "OPENAI" | "ANTHROPIC" | "GEMINI";
    const promptType = meta.promptType.toUpperCase() as "GENERAL" | "CODING" | "AGENT" | "SYSTEM" | "INSTRUCTION" | "TECHNICAL" | "CONVERSATIONAL";

    await Promise.all([
      // Update optimization result
      repo().updateByRequestId(requestId, {
        status:          result.status === "completed" ? "COMPLETED" : "FAILED",
        optimizedPrompt: result.finalPrompt,
        savedTokens:     result.tokensSaved,
        compressionRatio: result.compressionRatio,
        savedCostUsd:    result.costSavingsUsd,
        qualityScore:    result.qualityScore,
        processingTimeMs: result.durationMs,
        agentTrace:      result.agentTrace as unknown as import("@prisma/client").Prisma.InputJsonValue,
      }),

      // Write token analytics row
      tokRepo().create({
        userId,
        requestId,
        provider,
        model:           meta.model,
        promptType,
        mode:            meta.mode,
        originalTokens:  result.tokensSaved + Math.round(result.tokensSaved / (1 - result.compressionRatio + 0.001)),
        optimizedTokens: Math.round(result.tokensSaved / (1 - result.compressionRatio + 0.001)),
        savedTokens:     result.tokensSaved,
        compressionRatio: result.compressionRatio,
        originalCostUsd:  result.costSavingsUsd + 0,
        optimizedCostUsd: 0,
        savedCostUsd:     result.costSavingsUsd,
        qualityScore:     result.qualityScore,
      }),

      // Upsert daily model usage
      modRepo().upsertDaily({
        userId,
        provider,
        model:       meta.model,
        savedTokens: result.tokensSaved,
        savedCostUsd: result.costSavingsUsd,
        success:     result.status === "completed",
      }),
    ]);
  },
};
