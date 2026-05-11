/**
 * Cost Estimator Service
 *
 * Estimates API costs before making calls and calculates actual costs after.
 *
 * Why pre-estimation matters:
 * - Lets users see cost before submitting (UX)
 * - Enables budget enforcement (reject requests over threshold)
 * - Powers the cost analytics dashboard
 *
 * Output token estimation strategy:
 * - We don't know output length before the call
 * - Use historical averages per task type as defaults
 * - Allow callers to override with their own estimate
 */

import "server-only";

import { modelRegistry } from "@/services/ai/model-registry";
import { getTokenCounter } from "@/services/token/token-counter.service";
import type { AIMessage, AIModel, CostBreakdown } from "@/types/ai";
import type { TokenCostEstimate } from "@/types/tokenizer";

// ─── Output Token Estimates by Task ──────────────────────────────────────────

/**
 * Typical output token counts by task type.
 * Derived from empirical data — adjust based on your actual usage patterns.
 */
export const OUTPUT_TOKEN_ESTIMATES = {
  promptOptimization: 500,    // Optimized prompt is usually shorter than input
  summarization: 300,         // Summaries are concise
  analysis: 800,              // Analysis responses tend to be detailed
  chat: 400,                  // Average chat response
  codeGeneration: 1_200,      // Code tends to be verbose
  default: 500,
} as const;

export type TaskType = keyof typeof OUTPUT_TOKEN_ESTIMATES;

// ─── Cost Estimator ───────────────────────────────────────────────────────────

export class CostEstimatorService {
  private readonly tokenCounter = getTokenCounter();

  /**
   * Estimate cost for a completion request before sending it.
   */
  async estimateCompletionCost(
    messages: AIMessage[],
    model: AIModel,
    options?: {
      estimatedOutputTokens?: number;
      taskType?: TaskType;
    },
  ): Promise<TokenCostEstimate> {
    const messageCount = await this.tokenCounter.countMessages(messages, model);

    const estimatedOutputTokens =
      options?.estimatedOutputTokens ??
      OUTPUT_TOKEN_ESTIMATES[options?.taskType ?? "default"];

    const cost = modelRegistry.calculateCost(
      model,
      messageCount.tokenCount,
      estimatedOutputTokens,
    );

    return {
      model,
      inputTokens: messageCount.tokenCount,
      estimatedOutputTokens,
      cost,
      confidence: messageCount.isEstimate ? "estimated" : "exact",
    };
  }

  /**
   * Calculate actual cost from real token usage (post-completion).
   */
  calculateActualCost(
    model: AIModel,
    inputTokens: number,
    outputTokens: number,
  ): CostBreakdown {
    return modelRegistry.calculateCost(model, inputTokens, outputTokens);
  }

  /**
   * Compare costs across multiple models for the same request.
   * Useful for the model selection UI — show users the cost difference.
   */
  async compareCostsAcrossModels(
    messages: AIMessage[],
    models: AIModel[],
    taskType: TaskType = "default",
  ): Promise<ModelCostComparison[]> {
    const estimates = await Promise.all(
      models.map(async (model) => {
        try {
          const estimate = await this.estimateCompletionCost(messages, model, {
            taskType,
          });
          return { model, estimate, available: true };
        } catch {
          return { model, estimate: null, available: false };
        }
      }),
    );

    return estimates
      .filter((e): e is ModelCostComparison & { available: true } => e.available && e.estimate !== null)
      .sort((a, b) => a.estimate!.cost.totalCostUsd - b.estimate!.cost.totalCostUsd)
      .map((e, i) => ({ ...e, rank: i + 1 }));
  }

  /**
   * Calculate how much was saved by using a cheaper model or caching.
   */
  calculateSavings(
    originalModel: AIModel,
    actualModel: AIModel,
    inputTokens: number,
    outputTokens: number,
  ): {
    originalCost: CostBreakdown;
    actualCost: CostBreakdown;
    savedUsd: number;
    savingsPercent: number;
  } {
    const originalCost = modelRegistry.calculateCost(originalModel, inputTokens, outputTokens);
    const actualCost = modelRegistry.calculateCost(actualModel, inputTokens, outputTokens);
    const savedUsd = originalCost.totalCostUsd - actualCost.totalCostUsd;

    return {
      originalCost,
      actualCost,
      savedUsd: Number(savedUsd.toFixed(8)),
      savingsPercent:
        originalCost.totalCostUsd > 0
          ? Number(((savedUsd / originalCost.totalCostUsd) * 100).toFixed(2))
          : 0,
    };
  }

  /**
   * Project monthly cost based on daily usage.
   */
  projectMonthlyCost(
    dailyRequests: number,
    avgInputTokens: number,
    avgOutputTokens: number,
    model: AIModel,
  ): {
    dailyCostUsd: number;
    monthlyCostUsd: number;
    yearlyCostUsd: number;
  } {
    const perRequestCost = modelRegistry.calculateCost(model, avgInputTokens, avgOutputTokens);
    const dailyCostUsd = perRequestCost.totalCostUsd * dailyRequests;

    return {
      dailyCostUsd: Number(dailyCostUsd.toFixed(4)),
      monthlyCostUsd: Number((dailyCostUsd * 30).toFixed(4)),
      yearlyCostUsd: Number((dailyCostUsd * 365).toFixed(4)),
    };
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModelCostComparison {
  model: AIModel;
  estimate: TokenCostEstimate | null;
  available: boolean;
  rank?: number;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: CostEstimatorService | null = null;

export function getCostEstimator(): CostEstimatorService {
  instance ??= new CostEstimatorService();
  return instance;
}
