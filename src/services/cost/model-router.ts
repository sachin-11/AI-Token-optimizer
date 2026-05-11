/**
 * Model Router — Cost-Aware Routing Engine
 *
 * Selects the cheapest model that can handle a request at acceptable quality.
 *
 * Routing algorithm:
 * 1. Estimate token count for the request
 * 2. Filter models that fit in context window
 * 3. Score each model on cost × quality tradeoff
 * 4. Select based on strategy (cheapest / balanced / quality)
 *
 * Quality scores are empirical — based on benchmark data.
 * Adjust QUALITY_SCORES to match your use case.
 */

import "server-only";

import { createChildLogger } from "@/lib/logger";
import { modelRegistry } from "@/services/ai/model-registry";
import { getTokenCounter } from "@/services/token/token-counter.service";
import { getCostEstimator } from "@/services/token/cost-estimator.service";
import type { AIMessage, AIModel } from "@/types/ai";
import type { ModelAlternative, RoutingDecision, RoutingStrategy } from "@/types/cost-optimization";

const log = createChildLogger({ module: "ModelRouter" });

// ─── Quality Scores (0-100) ───────────────────────────────────────────────────
// Higher = better quality. Based on MMLU/HumanEval benchmarks + empirical data.

const QUALITY_SCORES: Record<string, number> = {
  "gpt-4o":                      95,
  "gpt-4-turbo":                 92,
  "claude-3-5-sonnet-20241022":  93,
  "claude-3-opus-20240229":      94,
  "gemini-1.5-pro":              88,
  "gpt-4o-mini":                 78,
  "claude-3-haiku-20240307":     72,
  "gemini-1.5-flash":            70,
  "gpt-3.5-turbo":               65,
  "gemini-1.0-pro":              60,
};

// Estimated p50 latency in ms
const LATENCY_ESTIMATES: Record<string, number> = {
  "gpt-4o":                      1_800,
  "gpt-4-turbo":                 2_200,
  "claude-3-5-sonnet-20241022":  2_000,
  "claude-3-opus-20240229":      4_000,
  "gemini-1.5-pro":              1_500,
  "gpt-4o-mini":                 800,
  "claude-3-haiku-20240307":     600,
  "gemini-1.5-flash":            500,
  "gpt-3.5-turbo":               700,
  "gemini-1.0-pro":              900,
};

// Minimum quality threshold per strategy
const QUALITY_THRESHOLDS: Record<RoutingStrategy, number> = {
  cheapest: 60,
  balanced: 72,
  quality:  88,
  fastest:  60,
};

// ─── Model Router ─────────────────────────────────────────────────────────────

export class ModelRouter {
  private readonly tokenCounter = getTokenCounter();
  private readonly costEstimator = getCostEstimator();

  /**
   * Select the optimal model for a request given a routing strategy.
   */
  async route(
    messages: AIMessage[],
    requestedModel: AIModel,
    strategy: RoutingStrategy = "balanced",
  ): Promise<RoutingDecision> {
    // Count tokens to filter by context window
    const tokenCount = await this.tokenCounter.countMessages(messages, requestedModel);
    const inputTokens = tokenCount.tokenCount;

    // Get all available models that fit in context
    const candidates = modelRegistry
      .getAll()
      .filter((m) => !m.isDeprecated && m.contextWindow >= inputTokens + 500)
      .filter((m) => (QUALITY_SCORES[m.id as string] ?? 0) >= QUALITY_THRESHOLDS[strategy]);

    if (candidates.length === 0) {
      // No candidates — use requested model as-is
      return this.buildDecision(requestedModel, requestedModel, strategy, 0, 0, "No cheaper alternatives available", []);
    }

    // Estimate cost for each candidate
    const scored = await Promise.all(
      candidates.map(async (m) => {
        const estimate = await this.costEstimator.estimateCompletionCost(messages, m.id, { taskType: "default" });
        const quality  = QUALITY_SCORES[m.id as string] ?? 70;
        const latency  = LATENCY_ESTIMATES[m.id as string] ?? 1500;
        const cost     = estimate.cost.totalCostUsd;

        // Composite score: lower is better
        const score = this.computeScore(cost, quality, latency, strategy);

        return { model: m.id, cost, quality, latency, score };
      }),
    );

    // Sort by score (ascending = better)
    scored.sort((a, b) => a.score - b.score);

    const best = scored[0]!;
    const originalEstimate = await this.costEstimator.estimateCompletionCost(messages, requestedModel, { taskType: "default" });
    const originalCost = originalEstimate.cost.totalCostUsd;
    const savings = originalCost - best.cost;
    const savingsPct = originalCost > 0 ? (savings / originalCost) * 100 : 0;

    const alternatives: ModelAlternative[] = scored.slice(1, 4).map((s) => ({
      model:            s.model,
      estimatedCostUsd: s.cost,
      qualityScore:     s.quality,
      latencyMs:        s.latency,
    }));

    const reason = this.buildReason(best.model, requestedModel, strategy, savings);

    log.info(
      { requestedModel, selectedModel: best.model, strategy, savings: savings.toFixed(6) },
      "Model routing decision",
    );

    return this.buildDecision(best.model, requestedModel, strategy, best.cost, savings, reason, alternatives);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private computeScore(
    cost: number,
    quality: number,
    latency: number,
    strategy: RoutingStrategy,
  ): number {
    // Normalize each dimension to 0-1 range
    const normCost    = Math.min(cost / 0.01, 1);       // $0.01 = max reference
    const normQuality = 1 - quality / 100;               // Invert: lower = better
    const normLatency = Math.min(latency / 5000, 1);     // 5s = max reference

    const weights: Record<RoutingStrategy, [number, number, number]> = {
      cheapest: [0.70, 0.20, 0.10],
      balanced: [0.40, 0.40, 0.20],
      quality:  [0.15, 0.70, 0.15],
      fastest:  [0.20, 0.20, 0.60],
    };

    const [wCost, wQuality, wLatency] = weights[strategy];
    return wCost! * normCost + wQuality! * normQuality + wLatency! * normLatency;
  }

  private buildReason(
    selected: AIModel,
    requested: AIModel,
    strategy: RoutingStrategy,
    savings: number,
  ): string {
    if (selected === requested) return "Requested model is already optimal";
    if (savings <= 0) return "Requested model is most cost-effective";
    return `Routed to ${String(selected)} (${strategy} strategy, saves $${savings.toFixed(6)})`;
  }

  private buildDecision(
    selectedModel: AIModel,
    originalModel: AIModel,
    strategy: RoutingStrategy,
    estimatedCostUsd: number,
    savingsVsOriginal: number,
    reason: string,
    alternatives: ModelAlternative[],
  ): RoutingDecision {
    const originalCost = estimatedCostUsd + savingsVsOriginal;
    return {
      selectedModel,
      originalModel,
      strategy,
      estimatedCostUsd,
      savingsVsOriginal: Number(savingsVsOriginal.toFixed(8)),
      savingsPercent: originalCost > 0
        ? Number(((savingsVsOriginal / originalCost) * 100).toFixed(2))
        : 0,
      reason,
      alternatives,
    };
  }
}

let instance: ModelRouter | null = null;
export function getModelRouter(): ModelRouter {
  instance ??= new ModelRouter();
  return instance;
}
