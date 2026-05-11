/**
 * Cost Optimizer — Main Facade
 *
 * Orchestrates all cost optimization strategies in the correct order:
 *
 *   1. Duplicate detection  → return cached if duplicate (free)
 *   2. Cache lookup         → return cached if hit (free)
 *   3. Budget check         → enforce limits before spending
 *   4. Context optimization → compress/summarize messages
 *   5. Model routing        → select cheapest adequate model
 *   6. Execute              → call AI provider
 *   7. Record               → update budget + dedup cache
 *
 * Each step is optional — callers can skip steps via options.
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { getModelRouter } from "@/services/cost/model-router";
import { getDuplicateDetector } from "@/services/cost/duplicate-detector";
import { getTokenBudgetManager } from "@/services/cost/token-budget-manager";
import { getContextOptimizer } from "@/services/cost/context-optimizer";
import { getCacheService } from "@/services/cache/cache.service";
import { getCostEstimator } from "@/services/token/cost-estimator.service";
import { registry } from "@/observability/metrics";
import type { AICompletionRequest, AICompletionResponse, AIMessage, AIModel } from "@/types/ai";
import type { CostOptimizedRequest, RoutingStrategy } from "@/types/cost-optimization";

const log = createChildLogger({ module: "CostOptimizer" });

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CostOptimizerOptions {
  userId?:           string;
  strategy?:         RoutingStrategy;
  skipCache?:        boolean;
  skipDedup?:        boolean;
  skipBudget?:       boolean;
  skipContextOpt?:   boolean;
  skipModelRouting?: boolean;
}

// ─── Cost Optimizer ───────────────────────────────────────────────────────────

export class CostOptimizer {
  private readonly modelRouter    = getModelRouter();
  private readonly dedupDetector  = getDuplicateDetector();
  private readonly budgetManager  = getTokenBudgetManager();
  private readonly contextOpt     = getContextOptimizer();
  private readonly cache          = getCacheService();
  private readonly costEstimator  = getCostEstimator();

  /**
   * Prepare an optimized request — applies all cost strategies.
   * Returns the optimized request + metadata about what was applied.
   */
  async prepareRequest(
    messages: AIMessage[],
    model: AIModel,
    options: CostOptimizerOptions = {},
  ): Promise<CostOptimizedRequest> {
    const { userId, strategy = "balanced" } = options;
    let currentMessages = messages;
    let currentModel    = model;
    const optimizations: CostOptimizedRequest["optimizations"] = [];

    // ── Step 1: Context optimization ──────────────────────────────────────────
    if (!options.skipContextOpt) {
      const ctxResult = await this.contextOpt.autoOptimize(currentMessages, currentModel);
      if (ctxResult.tokensSaved > 0) {
        currentMessages = ctxResult.messages;
        const savedUsd = await this.estimateSavings(model, ctxResult.tokensSaved);
        optimizations.push({
          type:        "context_compression",
          description: `Context ${ctxResult.strategy}: saved ${ctxResult.tokensSaved} tokens`,
          savedTokens: ctxResult.tokensSaved,
          savedUsd,
        });
      }
    }

    // ── Step 2: Model routing ──────────────────────────────────────────────────
    if (!options.skipModelRouting) {
      const routing = await this.modelRouter.route(currentMessages, currentModel, strategy);
      if (routing.selectedModel !== currentModel && routing.savingsVsOriginal > 0) {
        optimizations.push({
          type:        "model_downgrade",
          description: routing.reason,
          savedTokens: 0,
          savedUsd:    routing.savingsVsOriginal,
        });
        currentModel = routing.selectedModel;
      }
    }

    // ── Estimate final cost ────────────────────────────────────────────────────
    const estimate = await this.costEstimator.estimateCompletionCost(currentMessages, currentModel);
    const totalSavings = optimizations.reduce((sum, o) => sum + o.savedUsd, 0);

    log.info(
      {
        originalModel:   model,
        selectedModel:   currentModel,
        optimizations:   optimizations.map((o) => o.type),
        estimatedCost:   estimate.cost.totalCostUsd,
        totalSavings,
      },
      "Request prepared",
    );

    return {
      messages:         currentMessages,
      model:            currentModel,
      originalModel:    model,
      originalMessages: messages,
      optimizations,
      estimatedCostUsd: estimate.cost.totalCostUsd,
      estimatedSavings: totalSavings,
    };
  }

  /**
   * Full optimized completion — applies all strategies then executes.
   */
  async complete(
    request: AICompletionRequest,
    executor: (req: AICompletionRequest) => Promise<AICompletionResponse>,
    options: CostOptimizerOptions = {},
  ): Promise<AICompletionResponse & { optimizations: CostOptimizedRequest["optimizations"] }> {
    const { userId } = options;
    const prompt = request.messages.map((m) => m.content).join(" ");

    // ── Step 1: Duplicate detection ────────────────────────────────────────────
    if (!options.skipDedup && userId) {
      const dedup = await this.dedupDetector.check(request.messages, request.model ?? "gpt-4o", userId);
      if (dedup.isDuplicate && dedup.cachedResponse) {
        registry.inc("cache_hits_total", { type: "dedup" });
        log.info({ userId, savedCostUsd: dedup.savedCostUsd }, "Dedup hit");
        return { ...dedup.cachedResponse, optimizations: [{ type: "deduplication", description: "Duplicate request", savedTokens: 0, savedUsd: dedup.savedCostUsd ?? 0 }] };
      }
    }

    // ── Step 2: Cache lookup ───────────────────────────────────────────────────
    if (!options.skipCache) {
      const cached = await this.cache.get(prompt, request.model ?? "gpt-4o");
      if (cached.hit) {
        registry.inc("cache_hits_total", { type: "response" });
        return { ...cached.entry.data, optimizations: [{ type: "cache_hit", description: "Cache hit", savedTokens: cached.entry.data.usage.totalTokens, savedUsd: cached.entry.data.cost.totalCostUsd }] };
      }
    }

    // ── Step 3: Prepare optimized request ─────────────────────────────────────
    const optimized = await this.prepareRequest(
      request.messages,
      request.model ?? "gpt-4o",
      options,
    );

    // ── Step 4: Budget check ───────────────────────────────────────────────────
    if (!options.skipBudget && userId) {
      await this.budgetManager.enforce(userId, optimized.estimatedCostUsd * 1_000_000 / 0.15, optimized.estimatedCostUsd);
    }

    // ── Step 5: Execute ────────────────────────────────────────────────────────
    const response = await executor({
      ...request,
      messages: optimized.messages,
      model:    optimized.model,
    });

    // ── Step 6: Record ─────────────────────────────────────────────────────────
    if (userId) {
      void this.budgetManager.recordUsage(userId, response.usage.totalTokens, response.cost.totalCostUsd);
      void this.dedupDetector.record(request.messages, request.model ?? "gpt-4o", userId, response);
    }
    void this.cache.set(prompt, optimized.model, response);

    return { ...response, optimizations: optimized.optimizations };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async estimateSavings(model: AIModel, tokensSaved: number): Promise<number> {
    try {
      const { modelRegistry } = await import("@/services/ai/model-registry");
      const info = modelRegistry.find(model);
      if (!info) return 0;
      return (tokensSaved / 1_000_000) * info.inputCostPerMToken;
    } catch { return 0; }
  }
}

let instance: CostOptimizer | null = null;
export function getCostOptimizer(): CostOptimizer {
  instance ??= new CostOptimizer();
  return instance;
}
